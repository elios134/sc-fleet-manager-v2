import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { Crosshair, Loader2, Search, ChevronDown } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import Dropdown from "../../components/ui/Dropdown";
import { FavoriteItem, FicheTab, ListFilter, MissionListItem, ObjectiveItem, PER_PAGE, ScopeWithRanks, SortOrder } from "./helpers";
import { MissionLine } from "./components/MissionLine";
import { MissionFiche } from "./components/MissionFiche";

/* ──────────────────────────────────────────────────────────────────────────
 * Mission Hub (ex-« Mission Intel Hub ») — refonte 2 panneaux sur le modèle du
 * Crafting Hub : liste de missions filtrable à gauche, fiche à 2 onglets à droite
 * (Détails = ancienne modale + reco de farm ; Drop = blueprints cliquables →
 * Crafting Hub). Logique pure (types, réputation, reco de farm) dans helpers.ts,
 * composants de la liste et de la fiche dans components/.
 * ────────────────────────────────────────────────────────────────────────── */

export default function MissionHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [availableFactions, setAvailableFactions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [accountId, setAccountId] = useState("");

  const [objectiveUuids, setObjectiveUuids] = useState<Set<string>>(new Set());
  const [favoriteUuids, setFavoriteUuids] = useState<Set<string>>(new Set());

  // Recherche/filtres/onglets persistants → retrouvés en revenant (la navigation démonte la
  // page sinon tout est réinitialisé). page/factionsOpen restent transitoires.
  const [search, setSearch] = usePersistentState("intel.search", "");
  const [selectedFactions, setSelectedFactions] = usePersistentState<string[]>("intel.factions", []);
  const [sortOrder, setSortOrder] = usePersistentState<SortOrder>("intel.sort", "rep_desc");
  const [listFilter, setListFilter] = usePersistentState<ListFilter>("intel.listFilter", "all");
  const [factionsOpen, setFactionsOpen] = useState(false);
  const [page, setPage] = usePersistentState("intel.page", 1);

  const [selectedUuid, setSelectedUuid] = usePersistentState<string | null>("intel.selected", null);
  const [ficheTab, setFicheTab] = usePersistentState<FicheTab>("intel.ficheTab", "details");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Mount ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [missionsData, factionsData, objData, favData, scopesData] =
          await Promise.all([
            invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }),
            invoke<string[]>("get_distinct_factions"),
            invoke<ObjectiveItem[]>("list_objectives", { accountId: acc }),
            invoke<FavoriteItem[]>("list_favorites", { accountId: acc }),
            invoke<ScopeWithRanks[]>("get_scopes"),
          ]);
        if (cancelled) return;
        setAccountId(acc);
        setMissions(missionsData);
        setAvailableFactions(factionsData);
        setObjectiveUuids(new Set(objData.map((o) => o.uuid)));
        setFavoriteUuids(new Set(favData.map((f) => f.uuid)));
        setScopes(scopesData);
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

  async function toggleObjective(uuid: string) {
    if (!accountId) return;
    try {
      await invoke("toggle_objective", { accountId, missionUuid: uuid });
      const list = await invoke<ObjectiveItem[]>("list_objectives", { accountId });
      setObjectiveUuids(new Set(list.map((o) => o.uuid)));
    } catch {
      /* ignore */
    }
  }
  async function toggleFavorite(uuid: string) {
    if (!accountId) return;
    try {
      await invoke("toggle_favorite", { accountId, missionUuid: uuid });
      const list = await invoke<FavoriteItem[]>("list_favorites", { accountId });
      setFavoriteUuids(new Set(list.map((f) => f.uuid)));
    } catch {
      /* ignore */
    }
  }

  // ── Filtres / tri (missions publiées) ──
  const filtered = useMemo(() => {
    let list = missions.filter((m) => m.released);
    if (listFilter === "objectives") list = list.filter((m) => objectiveUuids.has(m.uuid));
    else if (listFilter === "favorites") list = list.filter((m) => favoriteUuids.has(m.uuid));
    else if (listFilter === "loot") list = list.filter((m) => m.hasBlueprints);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.factionName?.toLowerCase().includes(q) ?? false),
      );
    }
    if (selectedFactions.length > 0) {
      list = list.filter((m) => m.factionName != null && selectedFactions.includes(m.factionName));
    }

    const sorted = [...list];
    if (sortOrder === "rep_desc") {
      sorted.sort((a, b) => (b.reputationAmount ?? -Infinity) - (a.reputationAmount ?? -Infinity));
    } else if (sortOrder === "duration_asc") {
      sorted.sort((a, b) => (a.timeMins ?? Infinity) - (b.timeMins ?? Infinity));
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    }
    return sorted;
  }, [missions, listFilter, objectiveUuids, favoriteUuids, search, selectedFactions, sortOrder]);

  // Retour page 1 quand un filtre CHANGE réellement — pas au montage (préserve la page
  // restaurée). Comparaison à la valeur précédente → robuste au double-effet StrictMode.
  const prevPageKey = useRef(JSON.stringify([search, selectedFactions, sortOrder, listFilter]));
  useEffect(() => {
    const key = JSON.stringify([search, selectedFactions, sortOrder, listFilter]);
    if (prevPageKey.current !== key) {
      prevPageKey.current = key;
      setPage(1);
    }
  }, [search, selectedFactions, sortOrder, listFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const selected = useMemo(
    () => missions.find((m) => m.uuid === selectedUuid) ?? null,
    [missions, selectedUuid],
  );

  const lootCount = useMemo(
    () => missions.filter((m) => m.released && m.hasBlueprints).length,
    [missions],
  );

  function selectMission(uuid: string) {
    setSelectedUuid(uuid);
    setFicheTab("details");
  }

  return (
    <div className="flex h-full flex-col p-8">
      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("mission.loading")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("mission.errorPrefix")} {error}
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          {/* ── Panneau gauche ── */}
          <div className="flex min-h-0 flex-col rounded-2xl glass p-3">
            {/* Recherche */}
            <div className="relative mb-2.5 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mission.searchPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
              />
            </div>

            {/* Filtres : factions + tri */}
            <div className="mb-2.5 flex shrink-0 gap-2">
              <div className="relative flex-1">
                <button
                  onClick={() => setFactionsOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
                >
                  <span className="truncate">
                    {selectedFactions.length === 0
                      ? t("mission.allFactions")
                      : t("mission.factionsCount", { count: selectedFactions.length })}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </button>
                {factionsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setFactionsOpen(false)} />
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-[#15161c] p-1 shadow-2xl">
                      {selectedFactions.length > 0 && (
                        <button
                          onClick={() => setSelectedFactions([])}
                          className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] text-accent hover:bg-white/5"
                        >
                          {t("mission.deselectAll")}
                        </button>
                      )}
                      {availableFactions.map((f) => (
                        <label
                          key={f}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white/80 hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFactions.includes(f)}
                            onChange={() =>
                              setSelectedFactions((prev) =>
                                prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
                              )
                            }
                            className="accent-[var(--accent)]"
                          />
                          <span className="truncate">{f}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Dropdown
                value={sortOrder}
                onChange={(v) => setSortOrder(v as SortOrder)}
                buttonClassName="text-xs text-white/70"
                className="w-40"
                options={[
                  { value: "rep_desc", label: t("mission.sortRepDesc") },
                  { value: "duration_asc", label: t("mission.sortDurationAsc") },
                  { value: "alpha", label: t("mission.sortAlpha") },
                ]}
              />
            </div>

            {/* Chips Toutes / Objectifs / Favoris */}
            <div className="mb-2.5 flex shrink-0 gap-1.5">
              {(
                [
                  { key: "all", label: t("mission.filterAll") },
                  { key: "loot", label: t("mission.filterLoot"), badge: lootCount },
                  { key: "objectives", label: t("mission.tabObjectives"), badge: objectiveUuids.size },
                  { key: "favorites", label: t("mission.tabFavorites"), badge: favoriteUuids.size },
                ] as Array<{ key: ListFilter; label: string; badge?: number }>
              ).map((c) => (
                <button
                  key={c.key}
                  onClick={() => setListFilter(c.key)}
                  className={[
                    "flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                    listFilter === c.key
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10",
                  ].join(" ")}
                >
                  {c.label}
                  {c.badge != null && c.badge > 0 && (
                    <span className="rounded-full bg-white/10 px-1.5 text-[9px] tabular-nums">{c.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Liste */}
            <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {paginated.length === 0 ? (
                !loading && missions.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Crosshair}
                    title={t("empty.mission.title")}
                    text={t("empty.mission.text")}
                    action={{ label: t("empty.mission.action"), onClick: () => navigate("/settings#donnees") }}
                  />
                ) : (
                  <p className="px-1 py-6 text-center text-sm text-white/40">{t("mission.noResults")}</p>
                )
              ) : (
                paginated.map((m) => (
                  <MissionLine
                    key={m.uuid}
                    mission={m}
                    selected={m.uuid === selectedUuid}
                    isFavorite={favoriteUuids.has(m.uuid)}
                    onClick={() => selectMission(m.uuid)}
                    t={t}
                  />
                ))
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-2.5 flex shrink-0 items-center justify-between text-[11px] text-white/45">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/10 disabled:opacity-30"
                >
                  ←
                </button>
                <span className="tabular-nums">
                  {t("mission.pageOf", { page: safePage, total: totalPages })}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/10 disabled:opacity-30"
                >
                  →
                </button>
              </div>
            )}
          </div>

          {/* ── Panneau droit : fiche ── */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl glass">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-white/40">
                {t("mission.selectPrompt")}
              </div>
            ) : (
              <MissionFiche
                key={selected.uuid}
                mission={selected}
                missions={missions}
                scopes={scopes}
                accountId={accountId}
                ficheTab={ficheTab}
                setFicheTab={setFicheTab}
                isObjective={objectiveUuids.has(selected.uuid)}
                isFavorite={favoriteUuids.has(selected.uuid)}
                onToggleObjective={() => void toggleObjective(selected.uuid)}
                onToggleFavorite={() => void toggleFavorite(selected.uuid)}
                onOpenBlueprint={(id) => navigate("/industry/crafting", { state: { blueprintId: id } })}
                t={t}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
