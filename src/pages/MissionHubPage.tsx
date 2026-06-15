import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, Search, ChevronDown, Star, Target } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  type MissionListItem,
  type ScopeWithRanks,
  type ObjectiveItem,
  type FavoriteItem,
  FAMILY,
  mapScopeFamily,
  deriveStarRating,
  renderStars,
  formatRewardRange,
  calculateUecPerHour,
  formatUecPerHourCompact,
  isCleanDescription,
  mapRewardScopeToScopeName,
  findOptimalMission,
  computeRepeatsNeeded,
  computeTotalFarmTime,
  ReputationPanel,
  Section,
  StatCard,
} from "./MissionIntelPage";

/* ──────────────────────────────────────────────────────────────────────────
 * Mission Hub (ex-« Mission Intel Hub ») — refonte 2 panneaux sur le modèle du
 * Crafting Hub : liste de missions filtrable à gauche, fiche à 2 onglets à droite
 * (Détails = ancienne modale + reco de farm ; Drop = blueprints cliquables →
 * Crafting Hub). Toute la logique (réputation, helpers, reco) est réutilisée
 * depuis MissionIntelPage (exports), seule la présentation est refaite.
 * ────────────────────────────────────────────────────────────────────────── */

type ListFilter = "all" | "objectives" | "favorites" | "loot";
type SortOrder = "rep_desc" | "duration_asc" | "alpha";
type FicheTab = "details" | "drop";
const PER_PAGE = 40;

type MissionBlueprintDrop = {
  id: string;
  name: string | null;
  category: string | null;
  size: number | null;
  weight: number | null;
};

export default function MissionHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [availableFactions, setAvailableFactions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [missionCount, setMissionCount] = useState(0);
  const [accountId, setAccountId] = useState("");

  const [objectiveUuids, setObjectiveUuids] = useState<Set<string>>(new Set());
  const [favoriteUuids, setFavoriteUuids] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("rep_desc");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [factionsOpen, setFactionsOpen] = useState(false);
  const [page, setPage] = useState(1);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [ficheTab, setFicheTab] = useState<FicheTab>("details");

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
        const [missionsData, factionsData, objData, favData, status, scopesData] =
          await Promise.all([
            invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }),
            invoke<string[]>("get_distinct_factions"),
            invoke<ObjectiveItem[]>("list_objectives", { accountId: acc }),
            invoke<FavoriteItem[]>("list_favorites", { accountId: acc }),
            invoke<{ missionCount: number }>("get_missions_status"),
            invoke<ScopeWithRanks[]>("get_scopes"),
          ]);
        if (cancelled) return;
        setAccountId(acc);
        setMissions(missionsData);
        setAvailableFactions(factionsData);
        setObjectiveUuids(new Set(objData.map((o) => o.uuid)));
        setFavoriteUuids(new Set(favData.map((f) => f.uuid)));
        setMissionCount(status.missionCount);
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

  useEffect(() => {
    setPage(1);
  }, [search, selectedFactions, sortOrder, listFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const selected = useMemo(
    () => missions.find((m) => m.uuid === selectedUuid) ?? null,
    [missions, selectedUuid],
  );

  // Stats d'en-tête (réutilisées).
  const releasedCount = useMemo(() => missions.filter((m) => m.released).length, [missions]);
  const uniqueDrops = useMemo(
    () => new Set(missions.flatMap((m) => m.blueprints.map((b) => b.itemUuid))).size,
    [missions],
  );
  const dataminedCount = useMemo(
    () => missions.filter((m) => m.source === "datamining").length,
    [missions],
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
      <header className="mb-6 shrink-0">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Star Citizen</p>
        <h1 className="text-2xl font-bold text-white">{t("mission.hubTitle")}</h1>
      </header>

      {!loading && !error && missionCount > 0 && (
        <div className="mb-6 grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t("mission.statMissions")} value={releasedCount.toLocaleString("fr-FR")} />
          <StatCard label={t("mission.statFactions")} value={String(availableFactions.length)} />
          <StatCard label={t("mission.statUniqueDrops")} value={uniqueDrops.toLocaleString("fr-FR")} variant="gold" />
          <StatCard label={t("mission.statDatamined")} value={String(dataminedCount)} />
        </div>
      )}

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
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            {/* Recherche */}
            <div className="relative mb-2.5 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mission.searchPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
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
                          className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] text-amber-300 hover:bg-white/5"
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
                            className="accent-amber-400"
                          />
                          <span className="truncate">{f}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/70 focus:border-amber-400/40 focus:outline-none"
              >
                <option value="rep_desc" style={{ background: "#15161c" }}>{t("mission.sortRepDesc")}</option>
                <option value="duration_asc" style={{ background: "#15161c" }}>{t("mission.sortDurationAsc")}</option>
                <option value="alpha" style={{ background: "#15161c" }}>{t("mission.sortAlpha")}</option>
              </select>
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
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
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
                <p className="px-1 py-6 text-center text-sm text-white/40">{t("mission.noResults")}</p>
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
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
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
                onOpenBlueprint={(id) => navigate("/crafting", { state: { blueprintId: id } })}
                t={t}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Ligne de mission (gauche) ─────────────────────── */

function MissionLine({
  mission,
  selected,
  isFavorite,
  onClick,
  t,
}: {
  mission: MissionListItem;
  selected: boolean;
  isFavorite: boolean;
  onClick: () => void;
  t: TFunction;
}) {
  const fam = FAMILY[mapScopeFamily(mission)];
  const meta: string[] = [];
  if (mission.factionName) meta.push(mission.factionName);
  if (mission.minStandingValue) meta.push(renderStars(deriveStarRating(mission.minStandingValue)));
  if (mission.timeMins != null) meta.push(t("mission.minutes", { count: mission.timeMins }));

  return (
    <button
      onClick={onClick}
      className={[
        "w-full rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-amber-400/70 bg-gradient-to-b from-amber-400/[0.12] to-amber-400/[0.02]"
          : "border-white/10 bg-white/[0.02] hover:border-amber-400/30",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-white">
          {mission.title}
        </span>
        {mission.reputationAmount != null && (
          <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-amber-300">
            +{mission.reputationAmount.toLocaleString("fr-FR")} {t("mission.repSuffix")}
          </span>
        )}
      </div>
      {meta.length > 0 && (
        <div className="mt-1 truncate font-mono text-[11px] text-white/45">{meta.join(" · ")}</div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {mission.rewardScope && mission.rewardScope !== "Other" && (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase"
            style={{ color: fam.color, background: fam.bg, border: `1px solid ${fam.border}` }}
          >
            {mission.rewardScope}
          </span>
        )}
        {isFavorite && <span className="text-[11px] text-amber-300">★</span>}
        {mission.hasBlueprints && (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase"
            style={{ color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" }}
          >
            {t("mission.badgeLoot")}
          </span>
        )}
      </div>
    </button>
  );
}

/* ─────────────────────────── Fiche mission (droite) ─────────────────────────── */

function MissionFiche({
  mission,
  missions,
  scopes,
  accountId,
  ficheTab,
  setFicheTab,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  onOpenBlueprint,
  t,
}: {
  mission: MissionListItem;
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  ficheTab: FicheTab;
  setFicheTab: (tab: FicheTab) => void;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  onOpenBlueprint: (blueprintId: string) => void;
  t: TFunction;
}) {
  const fam = FAMILY[mapScopeFamily(mission)];
  const stars = mission.minStandingValue ? renderStars(deriveStarRating(mission.minStandingValue)) : null;

  return (
    <>
      {/* En-tête */}
      <div className="shrink-0 border-b border-white/5 bg-gradient-to-b from-amber-400/[0.05] to-transparent p-5">
        <p className="text-[10px] uppercase tracking-wider text-amber-200/70">
          {[mission.factionName, mission.rewardScope].filter(Boolean).join(" · ") || "—"}
        </p>
        <h2 className="mt-1 text-xl font-bold text-white">{mission.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mission.rewardScope && mission.rewardScope !== "Other" && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: fam.color, background: fam.bg, border: `1px solid ${fam.border}` }}
            >
              {mission.rewardScope}
            </span>
          )}
          {mission.illegal && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)" }}
            >
              {t("mission.badgeIllegal")}
            </span>
          )}
          {mission.hasBlueprints && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" }}
            >
              {t("mission.badgeLoot")}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
          {mission.reputationAmount != null && (
            <span className="font-semibold text-amber-300">
              +{mission.reputationAmount.toLocaleString("fr-FR")} {t("mission.repSuffix")}
            </span>
          )}
          {mission.timeMins != null && <span>· {t("mission.minutes", { count: mission.timeMins })}</span>}
          {stars && <span>· {stars}</span>}
        </div>
      </div>

      {/* Onglets */}
      <div className="flex shrink-0 gap-5 border-b border-white/5 px-5">
        {(["details", "drop"] as FicheTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFicheTab(tab)}
            className={[
              "border-b-2 py-2.5 text-sm transition-colors",
              ficheTab === tab
                ? "border-amber-400 font-semibold text-amber-300"
                : "border-transparent text-white/55 hover:text-white/80",
            ].join(" ")}
          >
            {tab === "details" ? t("mission.tabDetails") : t("mission.tabDrop")}
          </button>
        ))}
      </div>

      {/* Corps onglet */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {ficheTab === "details" ? (
          <DetailsTab
            mission={mission}
            missions={missions}
            scopes={scopes}
            accountId={accountId}
            isObjective={isObjective}
            isFavorite={isFavorite}
            onToggleObjective={onToggleObjective}
            onToggleFavorite={onToggleFavorite}
            t={t}
          />
        ) : (
          <DropTab mission={mission} onOpenBlueprint={onOpenBlueprint} t={t} />
        )}
      </div>
    </>
  );
}

/* ── Onglet Détails (ancienne modale + reco de farm) ── */

function DetailsTab({
  mission,
  missions,
  scopes,
  accountId,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  t,
}: {
  mission: MissionListItem;
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  t: TFunction;
}) {
  const [declaredRep, setDeclaredRep] = useState<number | null>(null);
  const uecPerHour = calculateUecPerHour(mission);
  const showDesc = isCleanDescription(mission.description);
  const wikiUrl = mission.webUrl ?? `https://star-citizen.wiki/Mission/${mission.uuid}`;

  // Prérequis (verdict comparé à la réputation déclarée).
  const reqValue = mission.minStandingValue;
  const hasPrereq = reqValue != null && reqValue > 0;
  const declared = declaredRep ?? 0;
  const scopeName = mapRewardScopeToScopeName(mission.rewardScope);
  const hasScope = !!(scopeName && scopes.some((s) => s.scopeName === scopeName));
  const reqMet = hasPrereq && declared >= (reqValue as number);
  const remaining = hasPrereq ? Math.max(0, (reqValue as number) - declared) : 0;

  // Reco de farm (même faction, meilleur ratio rep/min).
  const optimal = useMemo(
    () => findOptimalMission(missions, mission.factionUuid),
    [missions, mission.factionUuid],
  );
  const perRun = optimal?.reputationAmount ?? 0;
  const repeats = optimal ? computeRepeatsNeeded(reqValue ?? 0, declared, perRun) : 0;
  const totalFarmHours = computeTotalFarmTime(repeats, optimal?.timeMins ?? 0) / 60;

  return (
    <>
      {/* Statistiques */}
      <Section title={t("mission.statistics")}>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t("mission.reward")} value={formatRewardRange(mission)} caption={t("mission.auec")} variant="gold" />
          <StatCard
            label={t("mission.repXp")}
            value={mission.reputationAmount != null ? mission.reputationAmount.toLocaleString("fr-FR") : "—"}
            caption={t("mission.perRun")}
          />
          <StatCard
            label={t("mission.efficiency")}
            value={formatUecPerHourCompact(uecPerHour)}
            caption={t("mission.auecPerHour")}
            variant={uecPerHour != null ? "gold" : "neutral"}
          />
        </div>
      </Section>

      {/* Prérequis */}
      <Section title={t("mission.prereq")}>
        {!hasPrereq ? (
          <p className="text-sm italic text-white/40">{t("mission.noPrereq")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/80">
              🔒 {mission.factionName ? `${mission.factionName} : ` : ""}
              <strong className="text-white">{mission.minStandingName ?? "—"}</strong> (
              {t("mission.repParen", { rep: (reqValue as number).toLocaleString("fr-FR") })})
            </span>
            {!hasScope ? (
              <span className="text-xs italic text-white/40">{t("mission.repNotTracked")}</span>
            ) : reqMet ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.30)" }}
              >
                {t("mission.prereqMet")}
              </span>
            ) : (
              <span className="text-xs text-amber-300">
                {t("mission.repStillNeeded", { rep: remaining.toLocaleString("fr-FR") })}
              </span>
            )}
          </div>
        )}
      </Section>

      {/* Réputation déclarée + progression de grade */}
      <Section title={t("mission.reputation")}>
        <ReputationPanel
          rewardScope={mission.rewardScope}
          accountId={accountId}
          scopes={scopes}
          onReputation={setDeclaredRep}
        />
      </Section>

      {/* Recommandation de farm */}
      <Section title={t("mission.bestFarmMission")}>
        {!optimal ? (
          <p className="text-sm italic text-white/40">{t("mission.noMissionForFaction")}</p>
        ) : (
          <div
            className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: "rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.06)" }}
          >
            <p className="text-sm font-medium text-white">{optimal.title}</p>
            <p className="mt-0.5 text-xs text-white/70">
              {t("mission.farmLine", {
                rep: (optimal.reputationAmount ?? 0).toLocaleString("fr-FR"),
                min: optimal.timeMins,
              })}
              {repeats > 0 && (
                <>
                  {" · "}
                  {t("mission.farmRepeats", {
                    repeats,
                    hours: totalFarmHours.toLocaleString("fr-FR", { maximumFractionDigits: 1 }),
                  })}
                </>
              )}
            </p>
            {repeats === 0 && hasPrereq && (
              <p className="mt-1 text-xs font-semibold" style={{ color: "#34d399" }}>
                {t("mission.objectiveReached")}
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Description */}
      {showDesc && (
        <Section title={t("mission.description")}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{mission.description}</p>
        </Section>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={onToggleObjective}
          className={[
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
            isObjective ? "border text-[#60a5fa]" : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
          style={isObjective ? { borderColor: "rgba(96,165,250,0.35)", background: "rgba(96,165,250,0.12)" } : undefined}
        >
          <Target className="h-4 w-4" />
          {isObjective ? t("mission.objectiveTracked") : t("mission.addObjective")}
        </button>
        <button
          onClick={onToggleFavorite}
          className={[
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
            isFavorite ? "border text-amber-300" : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
          style={isFavorite ? { borderColor: "rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.12)" } : undefined}
        >
          <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
          {t("mission.favorite")}
        </button>
        <button
          onClick={() => void openUrl(wikiUrl)}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          {t("mission.viewWiki")}
        </button>
      </div>
    </>
  );
}

/* ── Onglet Drop (blueprints obtenables, cliquables → Crafting Hub) ── */

function DropTab({
  mission,
  onOpenBlueprint,
  t,
}: {
  mission: MissionListItem;
  onOpenBlueprint: (blueprintId: string) => void;
  t: TFunction;
}) {
  const [drops, setDrops] = useState<MissionBlueprintDrop[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDrops(null);
    invoke<MissionBlueprintDrop[]>("get_mission_blueprints", { missionUuid: mission.uuid })
      .then((d) => {
        if (!cancelled) setDrops(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) setDrops([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mission.uuid]);

  if (drops === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("mission.loading")}
      </div>
    );
  }
  if (drops.length === 0) {
    return <p className="text-sm italic text-white/40">{t("mission.dropNone")}</p>;
  }

  return (
    <>
      <p className="mb-3 text-xs text-white/45">{t("mission.dropHint")}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {drops.map((d) => {
          const sub = [
            d.category ?? undefined,
            d.size != null ? `S${d.size}` : undefined,
            d.weight != null ? t("mission.dropChance", { pct: Math.round(d.weight * 100) }) : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={d.id}
              onClick={() => onOpenBlueprint(d.id)}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-amber-400/60 hover:bg-amber-400/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{d.name ?? "—"}</div>
                {sub && <div className="mt-0.5 truncate text-[11px] text-white/40">{sub}</div>}
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-amber-300">{t("mission.dropOpen")}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
