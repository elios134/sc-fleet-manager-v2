import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { ChevronLeft, ChevronRight, Loader2, Recycle, Search } from "lucide-react";
import { type CraftingHubBlueprintItem, type CraftingStats, type OwnedFilter, type SearchMode, type Family } from "./types";
import { FAMILY_ORDER, familyLabel, KNOWN_SHIP_COMPONENT_TYPES, familyOf, suggestBlueprint } from "./helpers";
import { BlueprintRow } from "./components/BlueprintRow";
import { BlueprintDetailPanel } from "./components/BlueprintDetailPanel";

export default function CraftingHubPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CraftingHubBlueprintItem[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<CraftingStats | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  // Recherche/filtres/sélection persistants → retrouvés en revenant sur la page (la navigation
  // démonte la page sinon tout est réinitialisé). currentPage reste transitoire (repart à 1).
  const [search, setSearch] = usePersistentState("crafting.search", "");
  const [searchMode, setSearchMode] = usePersistentState<SearchMode>("crafting.searchMode", "name");
  const [ownedFilter, setOwnedFilter] = usePersistentState<OwnedFilter>("crafting.owned", "all");
  // Catégorie ouverte dans la liste : null = on affiche la LISTE DES CATÉGORIES ; sinon, tous
  // les items de cette famille (plus de pagination).
  const [openFamily, setOpenFamily] = usePersistentState<Family | null>("crafting.openFamily", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = usePersistentState<string | null>("crafting.selected", null);
  // Re-cochage depuis Game.log : état + récap affiché.
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  // Noms de log non appariés (mapping manuel) + valeur saisie par ligne.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});

  // Pré-sélection d'un blueprint à l'arrivée (ex. depuis l'onglet Drop du Mission Hub).
  const location = useLocation();
  useEffect(() => {
    const st = location.state as { blueprintId?: string } | null;
    if (st && typeof st.blueprintId === "string") setSelectedId(st.blueprintId);
  }, [location.state]);

  // ── Mount ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [blueprints, statsData, owned] = await Promise.all([
          invoke<CraftingHubBlueprintItem[]>("list_blueprints"),
          invoke<CraftingStats>("get_crafting_stats"),
          invoke<string[]>("list_blueprint_owned", { accountId: acc }),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setItems(blueprints);
        setStats(statsData);
        setOwnedIds(new Set(owned));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-coche les blueprints débloqués en jeu (lecture Game.log), puis recharge les possédés.
  type ResyncRecap = {
    logFound: boolean;
    detected: number;
    alreadyOwned: number;
    newlyChecked: number;
    ambiguousSkipped: number;
    unmatched: number;
    unmatchedNames: string[];
  };
  async function handleResync() {
    if (resyncing || !accountId) return;
    setResyncing(true);
    setResyncMsg(null);
    try {
      const r = await invoke<ResyncRecap>("resync_blueprints_from_log", { accountId });
      if (!r.logFound) {
        setResyncMsg(t("crafting.resyncLogNotFound"));
        setUnmatched([]);
      } else if (r.detected === 0) {
        setResyncMsg(t("crafting.resyncNoneDetected"));
        setUnmatched([]);
      } else {
        // Recharge les possédés (la map a pu changer).
        const owned = await invoke<string[]>("list_blueprint_owned", { accountId });
        setOwnedIds(new Set(owned));
        const extra =
          r.unmatched > 0 ? t("crafting.resyncUnmatched", { count: r.unmatched }) : "";
        setResyncMsg(
          t("crafting.resyncDetected", {
            detected: r.detected,
            newlyChecked: r.newlyChecked,
            alreadyOwned: r.alreadyOwned,
            extra,
          }),
        );
        // Surface les non-appariés + pré-remplit chaque ligne avec le blueprint le
        // plus probable (similarité) → l'utilisateur n'a qu'à confirmer.
        const names = r.unmatchedNames ?? [];
        setUnmatched(names);
        const prefill: Record<string, string> = {};
        for (const n of names) {
          const bp = suggestBlueprint(n, items);
          if (bp) prefill[n] = bp.displayName;
        }
        setAliasInputs(prefill);
      }
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResyncing(false);
    }
  }

  // Associe un nom de log non apparié au blueprint choisi (persiste + coche).
  async function mapAlias(logName: string) {
    const typed = (aliasInputs[logName] ?? "").trim();
    if (!typed || !accountId) return;
    const bp = items.find((it) => it.displayName === typed);
    if (!bp) {
      setResyncMsg(t("crafting.unmatchedNoBp"));
      return;
    }
    try {
      await invoke("set_blueprint_log_alias", { accountId, logName, blueprintId: bp.id });
      setOwnedIds((prev) => new Set(prev).add(bp.id));
      setUnmatched((prev) => prev.filter((n) => n !== logName));
      setAliasInputs((p) => {
        const next = { ...p };
        delete next[logName];
        return next;
      });
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleOwned(blueprintId: string) {
    if (!accountId) return;
    try {
      const res = await invoke<{ owned: boolean }>("toggle_blueprint_owned", {
        accountId,
        blueprintId,
      });
      setOwnedIds((prev) => {
        const next = new Set(prev);
        if (res.owned) next.add(blueprintId);
        else next.delete(blueprintId);
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  // ── Familles FR groupées (dérivées de output.type), avec compteurs ──
  const familyData = useMemo(() => {
    const counts = new Map<Family, number>();
    const unmapped = new Set<string>();
    for (const it of items) {
      const fam = familyOf(it.category);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
      // Signale les types vaisseau non répertoriés (rangés par défaut dans Composants).
      if (fam === "Composants vaisseau" && !KNOWN_SHIP_COMPONENT_TYPES.has(it.category)) {
        unmapped.add(it.category);
      }
    }
    const families = FAMILY_ORDER.filter((f) => (counts.get(f) ?? 0) > 0);
    return { counts, families, unmapped };
  }, [items]);

  // Signale en console (une fois) les types non mappés explicitement → famille par défaut.
  useEffect(() => {
    if (familyData.unmapped.size > 0) {
      console.warn(
        "[CraftingHub] types non répertoriés → Composants vaisseau :",
        [...familyData.unmapped],
      );
    }
  }, [familyData]);

  // ── Filtres client ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (ownedFilter === "owned" && !ownedIds.has(it.id)) return false;
      if (ownedFilter === "remaining" && ownedIds.has(it.id)) return false;
      if (q.length > 0) {
        // Mode NOM : nom du blueprint/objet produit. Mode INGRÉDIENT : matériau de la recette
        // (« iron » → tous les crafts qui contiennent de l'iron). Toggle Nom/Matériau au-dessus.
        const match =
          searchMode === "ingredient"
            ? (it.ingredientNames ?? []).some((n) => n.toLowerCase().includes(q))
            : `${it.displayName} ${it.producedItemName ?? ""}`.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [items, search, searchMode, ownedFilter, ownedIds]);

  // Recherche active → on court-circuite le drill-down par catégorie et on liste à plat les
  // résultats (toutes familles). Sinon : catégorie ouverte → ses items ; aucune → liste des
  // catégories. Plus de pagination : tout défile.
  const searching = search.trim().length > 0;
  const familyItems = openFamily
    ? filtered.filter((it) => familyOf(it.category) === openFamily)
    : [];

  const total = stats?.total ?? 0;

  return (
    <div className="p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t('crafting.eyebrow')}</p>
          <h1 className="text-2xl font-bold text-white">{t('crafting.title')}</h1>
          <p className="mt-1 max-w-xl text-[13px] text-white/45">{t('crafting.subtitle')}</p>
        </div>
        {/* Re-cochage depuis le jeu (Game.log) — action secondaire, coin haut-droite */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            onClick={() => void handleResync()}
            disabled={resyncing || !accountId}
            title={t('crafting.resyncTitle')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resyncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t('crafting.readingGame')}
              </>
            ) : (
              <>
                <Recycle className="h-4 w-4" /> {t('crafting.resyncFromGame')}
              </>
            )}
          </button>
          {resyncMsg && <span className="text-[11px] text-white/50">{resyncMsg}</span>}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('crafting.loadingCatalogue')}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t('crafting.errorPrefix', { message: error })}
        </p>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">
            {t('crafting.catalogueEmpty')}
          </p>
          <Link
            to="/settings"
            className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('crafting.goToSettings')}
          </Link>
        </div>
      ) : (
        <>
          {/* Non appariés : mapping manuel (mémorisé pour les prochains re-cochages) */}
          {unmatched.length > 0 && (
            <div className="mb-5 rounded-2xl border border-white/10 bg-[#14101f]/70 p-4 backdrop-blur-xl">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-accent">
                <Recycle className="h-4 w-4" />
                {t("crafting.unmatchedTitle", { count: unmatched.length })}
              </div>
              <p className="mb-3 text-xs text-white/45">{t("crafting.unmatchedHint")}</p>
              <datalist id="bp-alias-list">
                {items.map((it) => (
                  <option key={it.id} value={it.displayName} />
                ))}
              </datalist>
              <div className="grid gap-2 sm:grid-cols-2">
                {unmatched.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white" title={name}>
                      {name}
                    </span>
                    <input
                      list="bp-alias-list"
                      value={aliasInputs[name] ?? ""}
                      onChange={(e) =>
                        setAliasInputs((p) => ({ ...p, [name]: e.target.value }))
                      }
                      placeholder={t("crafting.unmatchedPick")}
                      className="w-40 shrink-0 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
                    />
                    <button
                      onClick={() => void mapAlias(name)}
                      disabled={!(aliasInputs[name] ?? "").trim()}
                      className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t("crafting.unmatchedAssign")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filtres */}
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchMode === "ingredient" ? t('crafting.searchByMaterial') : t('crafting.searchPlaceholder')}
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                />
              </div>

              {/* Toggle mode de recherche : par Nom / par Matériau (ingrédient) */}
              <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                {(["name", "ingredient"] as SearchMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSearchMode(m)}
                    className={[
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      searchMode === m ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
                    ].join(" ")}
                  >
                    {m === "name" ? t('crafting.searchModeName') : t('crafting.searchModeMaterial')}
                  </button>
                ))}
              </div>

              {/* Segmenté owned */}
              <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                {(["all", "owned", "remaining"] as OwnedFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOwnedFilter(f)}
                    className={[
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      ownedFilter === f ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
                    ].join(" ")}
                  >
                    {f === "all"
                      ? t('crafting.filterAll')
                      : f === "owned"
                        ? t('crafting.filterOwned')
                        : t('crafting.filterRemaining')}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* 2 panneaux : liste (gauche) + fiche (droite). Empilé sur étroit. */}
          <div className="flex flex-col gap-4 lg:h-[calc(100vh-320px)] lg:flex-row">
            {/* ── PANNEAU GAUCHE : liste verticale scrollable ── */}
            <div className="flex flex-col lg:w-[340px] lg:shrink-0 lg:overflow-y-auto">
              {searching ? (
                /* Recherche active → résultats à plat (toutes familles), sans pagination. */
                filtered.length === 0 ? (
                  <p className="text-sm text-white/40">{t('crafting.noMatch')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {filtered.map((it) => (
                      <BlueprintRow
                        key={it.id}
                        item={it}
                        owned={ownedIds.has(it.id)}
                        selected={selectedId === it.id}
                        onClick={() => setSelectedId(it.id)}
                      />
                    ))}
                  </div>
                )
              ) : openFamily ? (
                /* Catégorie ouverte → retour + tous ses items. */
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenFamily(null)}
                    className="mb-1 flex items-center gap-1.5 self-start text-[12px] font-medium text-white/50 transition-colors hover:text-white/90"
                  >
                    <ChevronLeft className="h-4 w-4" /> {t('crafting.allCategories')}
                  </button>
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-white/50">
                      {familyLabel(openFamily, t)}
                    </span>
                    <span className="rounded-full bg-white/10 px-1.5 text-[10.5px] tabular-nums text-white/45">
                      {familyItems.length}
                    </span>
                  </div>
                  {familyItems.length === 0 ? (
                    <p className="text-sm text-white/40">{t('crafting.noMatch')}</p>
                  ) : (
                    familyItems.map((it) => (
                      <BlueprintRow
                        key={it.id}
                        item={it}
                        owned={ownedIds.has(it.id)}
                        selected={selectedId === it.id}
                        onClick={() => setSelectedId(it.id)}
                      />
                    ))
                  )}
                </div>
              ) : (
                /* Par défaut → LISTE DES CATÉGORIES cliquables (Armes FPS, Composants vaisseau…). */
                <div className="flex flex-col gap-1.5">
                  {familyData.families.map((fam) => (
                    <button
                      key={fam}
                      type="button"
                      onClick={() => setOpenFamily(fam)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.07]"
                    >
                      <span className="text-[14px] font-medium text-white">{familyLabel(fam, t)}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/50">
                          {familyData.counts.get(fam) ?? 0}
                        </span>
                        <ChevronRight className="h-4 w-4 text-white/35" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── PANNEAU DROIT : fiche du blueprint sélectionné ── */}
            <div
              className="min-w-0 flex-1 overflow-hidden rounded-2xl border lg:overflow-y-auto"
              style={{ background: "rgba(18,16,22,0.55)", borderColor: "color-mix(in oklab, var(--accent) 20%, transparent)" }}
            >
              {selectedId ? (
                <BlueprintDetailPanel
                  key={selectedId}
                  blueprintId={selectedId}
                  accountId={accountId}
                  isOwned={ownedIds.has(selectedId)}
                  onToggleOwned={() => toggleOwned(selectedId)}
                />
              ) : (
                <div className="flex h-full min-h-[300px] items-center justify-center p-10 text-center text-sm text-white/40">
                  {t('crafting.selectPrompt')}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
