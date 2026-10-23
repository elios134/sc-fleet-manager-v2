import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Hammer, Loader2, Recycle, Search } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { type OwnedFilter, type SearchMode } from "./types";
import { familyLabel } from "./helpers";
import { BlueprintRow } from "./components/BlueprintRow";
import { BlueprintDetailPanel } from "./components/BlueprintDetailPanel";

import { useCraftingHub } from "./hooks/useCraftingHub";

export default function CraftingHubPage() {
  const navigate = useNavigate();
  const {
    t,
    items,
    ownedIds,
    accountId,
    search,
    setSearch,
    searchMode,
    setSearchMode,
    ownedFilter,
    setOwnedFilter,
    openFamily,
    setOpenFamily,
    loading,
    error,
    selectedId,
    setSelectedId,
    resyncing,
    resyncMsg,
    unmatched,
    aliasInputs,
    setAliasInputs,
    handleResync,
    mapAlias,
    toggleOwned,
    familyData,
    filtered,
    searching,
    familyItems,
    total,
  } = useCraftingHub();
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
        <EmptyState
          icon={Hammer}
          title={t("empty.crafting.title")}
          text={t("empty.crafting.text")}
          action={{ label: t("empty.crafting.action"), onClick: () => navigate("/settings#donnees") }}
        />
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
