import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, Loader2, Search, Star, Target, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import StatCard from "../components/ui/StatCard";
import Dropdown from "../components/ui/Dropdown";
import { filterSortMissions } from "../lib/missionFilter";

export { StatCard };

/* ── Types (identiques à la V1 MissionListItem) ── */

export type MissionListItem = {
  uuid: string;
  title: string;
  description: string | null;
  factionName: string | null;
  factionUuid: string | null;
  factionType: string | null;
  rewardScope: string | null;
  illegal: boolean;
  legalityLabel: string | null;
  hasBlueprints: boolean;
  blueprintDropChance: number | null;
  rewardMin: number | null;
  rewardMax: number | null;
  rewardCurrency: string | null;
  timeMins: number | null;
  shareable: boolean;
  hasCombat: boolean;
  hasHauling: boolean;
  hasDefend: boolean;
  minStandingName: string | null;
  minStandingValue: number | null;
  maxStandingName: string | null;
  maxStandingValue: number | null;
  released: boolean;
  workInProgress: boolean;
  notForRelease: boolean;
  starSystems: string | null;
  reputationGained: string | null;
  cooldownJson: string | null;
  reputationAmount: number | null;
  gameVersion: string | null;
  webUrl: string | null;
  source: string;
  blueprints: Array<{ name: string; itemUuid: string }>;
};

export type ObjectiveItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  minStandingName: string | null;
  minStandingValue: number | null;
  status: string | null;
  notes: string | null;
  updatedAt: string | null;
};

export type FavoriteItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  note: string | null;
  createdAt: string | null;
};

type MissionsStatus = {
  missionCount: number;
  lastSyncedAt: string | null;
  lastSyncedGameVersion: string | null;
};

type Tab = "missions" | "objectives" | "favorites";
type SortOrder = "rep_desc" | "duration_asc" | "alpha";

const PER_PAGE = 20;

/* ── Helpers visuels (réplique missionHelpers.ts V1) ── */

type ScopeFamily = "combat" | "cargo" | "hauling" | "recovery" | "salvage" | "other";

// Couleurs par famille (codes V1 adaptés au thème V2 : combat=rouge, cargo/hauling=or,
// recovery=bleu, salvage/other=neutre).
export const FAMILY: Record<ScopeFamily, { color: string; bg: string; border: string }> = {
  combat: { color: "#f87171", bg: "rgba(248,113,113,0.14)", border: "rgba(248,113,113,0.30)" },
  cargo: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  hauling: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  recovery: { color: "#60a5fa", bg: "rgba(96,165,250,0.14)", border: "rgba(96,165,250,0.30)" },
  salvage: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
  other: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
};

export function mapScopeFamily(m: MissionListItem): ScopeFamily {
  const s = (m.rewardScope ?? "").toLowerCase();
  if (
    m.hasCombat || s.includes("combat") || s.includes("assassin") || s.includes("bounty") ||
    s.includes("patrol") || s.includes("elimin") || s.includes("murder") || s.includes("hunt")
  )
    return "combat";
  if (s.includes("salvage")) return "salvage";
  if (s.includes("recovery") || s.includes("rescue") || s.includes("retrieval")) return "recovery";
  if (m.hasHauling || s.includes("hauling")) return "hauling";
  if (s.includes("cargo") || s.includes("delivery") || s.includes("transport")) return "cargo";
  return "other";
}

export function scopeIcon(scope: string | null): string {
  if (!scope) return "◇";
  const s = scope.toLowerCase();
  if (s.includes("assassin") || s.includes("elimin") || s.includes("murder")) return "◆";
  if (s.includes("delivery") || s.includes("cargo") || s.includes("transport")) return "▷";
  if (s.includes("bounty") || s.includes("patrol")) return "◈";
  if (s.includes("salvage")) return "⟁";
  return "◇";
}

export function deriveStarRating(v: number | null): number {
  if (!v) return 1;
  if (v < 10_000) return 2;
  if (v < 50_000) return 3;
  if (v < 100_000) return 4;
  return 5;
}

export function renderStars(count: number): string {
  const n = Math.max(1, Math.min(5, count));
  return "●".repeat(n) + "○".repeat(5 - n);
}

export function deriveTierLabel(v: number | null, t: (key: string) => string): string {
  switch (deriveStarRating(v)) {
    case 1: return t("mission.tier.beginner");
    case 2: return t("mission.tier.accessible");
    case 3: return t("mission.tier.standard");
    case 4: return t("mission.tier.advanced");
    default: return t("mission.tier.high");
  }
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function formatRewardRange(m: MissionListItem): string {
  if (m.rewardMin == null || m.rewardMax == null) return "—";
  const min = formatLargeNumber(m.rewardMin);
  const max = formatLargeNumber(m.rewardMax);
  return min === max ? max : `${min}–${max}`;
}

export function calculateUecPerHour(m: MissionListItem): number | null {
  if (m.rewardMin == null || m.rewardMax == null || !m.timeMins) return null;
  const avg = (m.rewardMin + m.rewardMax) / 2;
  return Math.round(avg / (m.timeMins / 60));
}

export function formatUecPerHourCompact(v: number | null): string {
  return v == null ? "—" : `${formatLargeNumber(v)}/h`;
}

// Masque les descriptions à template dynamique non résolu (~mission(...), etc.).
export function isCleanDescription(d: string | null): boolean {
  if (!d) return false;
  return !/~(?:mission_giver|mission|ship|location|item)\(/.test(d);
}

/* ── Scope / Rank (réputation) ── */

type Rank = {
  id: string;
  scopeId: string;
  name: string;
  nameKey: string;
  minReputation: number;
  rangeXP: number | null;
  rankIndex: number;
};
export type ScopeWithRanks = { id: string; scopeName: string; displayName: string; ranks: Rank[] };
type ScopeProgress = {
  id: number;
  accountId: string;
  scopeId: string;
  currentReputation: number;
  declaredAt: string;
  updatedAt: string;
};

// Mapping mission.rewardScope → scopeName interne (réplique scopeMapping.ts V1).
const SCOPE_NAME_MAP: Record<string, string | null> = {
  Assassination: "Assassination",
  "Bounty Hunter": "BountyHunter",
  "Bounty Hunters Guild": "BountyHunter_BountyHuntersGuild",
  Cargo: null,
  "Cargo Transport": null,
  Combat: "ShipCombat_HeadHunters",
  "Combat Assist": "ShipCombat_HeadHunters",
  Delivery: null,
  Hauling: "Hauling",
  Medical: null,
  Mining: null,
  Security: "Security",
  Transport: "Hauling",
  Recovery: null,
  Salvage: null,
  Wikelo: "Wikelo",
};

export function mapRewardScopeToScopeName(rewardScope: string | null): string | null {
  if (!rewardScope) return "FactionReputation";
  return SCOPE_NAME_MAP[rewardScope] ?? null;
}

type RankComputation = {
  currentRank: Rank | null;
  nextRank: Rank | null;
  progressPercent: number;
  repToNextRank: number;
};

// Réplique fidèle de computeCurrentRank V1 (missionHelpers.ts).
function computeCurrentRank(currentReputation: number, ranks: Rank[]): RankComputation {
  if (ranks.length === 0) {
    return { currentRank: null, nextRank: null, progressPercent: 0, repToNextRank: 0 };
  }
  const sorted = [...ranks].sort((a, b) => a.rankIndex - b.rankIndex);
  let currentRank: Rank | null = sorted[0] ?? null;
  let nextRank: Rank | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r && currentReputation >= r.minReputation) {
      currentRank = r;
      nextRank = sorted[i + 1] ?? null;
    }
  }
  if (!nextRank) {
    return { currentRank, nextRank: null, progressPercent: 100, repToNextRank: 0 };
  }
  const rangeInRank = nextRank.minReputation - (currentRank?.minReputation ?? 0);
  const repInRank = currentReputation - (currentRank?.minReputation ?? 0);
  const progressPercent =
    rangeInRank > 0 ? Math.min(100, Math.round((repInRank / rangeInRank) * 100)) : 0;
  return {
    currentRank,
    nextRank,
    progressPercent,
    repToNextRank: nextRank.minReputation - currentReputation,
  };
}

export default function MissionIntelPage() {
  const { t } = useTranslation();
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [availableFactions, setAvailableFactions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [missionCount, setMissionCount] = useState(0);

  const [accountId, setAccountId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("missions");
  const [search, setSearch] = useState("");
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("rep_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMission, setModalMission] = useState<MissionListItem | null>(null);
  const [factionsOpen, setFactionsOpen] = useState(false);

  const objectiveUuids = useMemo(() => new Set(objectives.map((o) => o.uuid)), [objectives]);
  const favoriteUuids = useMemo(() => new Set(favorites.map((f) => f.uuid)), [favorites]);

  // ── Mount ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [missionsData, factionsData, objData, favData, status, scopesData] = await Promise.all([
          invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }),
          invoke<string[]>("get_distinct_factions"),
          invoke<ObjectiveItem[]>("list_objectives", { accountId: acc }),
          invoke<FavoriteItem[]>("list_favorites", { accountId: acc }),
          invoke<MissionsStatus>("get_missions_status"),
          invoke<ScopeWithRanks[]>("get_scopes"),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setMissions(missionsData);
        setAvailableFactions(factionsData);
        setObjectives(objData);
        setFavorites(favData);
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

  async function reloadObjectives() {
    try {
      setObjectives(await invoke<ObjectiveItem[]>("list_objectives", { accountId }));
    } catch {
      /* ignore */
    }
  }
  async function reloadFavorites() {
    try {
      setFavorites(await invoke<FavoriteItem[]>("list_favorites", { accountId }));
    } catch {
      /* ignore */
    }
  }

  async function toggleObjective(missionUuid: string) {
    if (!accountId) return;
    await invoke("toggle_objective", { accountId, missionUuid });
    await reloadObjectives();
  }
  async function toggleFavorite(missionUuid: string) {
    if (!accountId) return;
    await invoke("toggle_favorite", { accountId, missionUuid });
    await reloadFavorites();
  }
  async function saveNote(missionUuid: string, note: string) {
    if (!accountId) return;
    await invoke("update_favorite_note", { accountId, missionUuid, note: note || null });
    await reloadFavorites();
  }

  // ── Filtres client (sur missions released) ──
  const filtered = useMemo(
    () => filterSortMissions(missions, search, selectedFactions, sortOrder),
    [missions, search, selectedFactions, sortOrder],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedFactions, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  function toggleFactionFilter(faction: string) {
    setSelectedFactions((prev) =>
      prev.includes(faction) ? prev.filter((f) => f !== faction) : [...prev, faction],
    );
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: "missions", label: t("mission.tabMissions") },
    { key: "objectives", label: t("mission.tabObjectives"), badge: objectives.length },
    { key: "favorites", label: t("mission.tabFavorites"), badge: favorites.length },
  ];

  // Stats d'en-tête (4 StatCards V1).
  const releasedCount = useMemo(() => missions.filter((m) => m.released).length, [missions]);
  const uniqueDrops = useMemo(
    () => new Set(missions.flatMap((m) => m.blueprints.map((b) => b.itemUuid))).size,
    [missions],
  );
  const dataminedCount = useMemo(
    () => missions.filter((m) => m.source === "datamining").length,
    [missions],
  );

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Star Citizen</p>
        <h1 className="text-2xl font-bold text-white">{t("mission.hubTitle")}</h1>
      </header>

      {/* StatCards (4) */}
      {!loading && !error && missionCount > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t("mission.statMissions")} value={releasedCount.toLocaleString("fr-FR")} />
          <StatCard label={t("mission.statFactions")} value={String(availableFactions.length)} />
          <StatCard label={t("mission.statUniqueDrops")} value={uniqueDrops.toLocaleString("fr-FR")} variant="gold" />
          <StatCard label={t("mission.statDatamined")} value={String(dataminedCount)} />
        </div>
      )}

      {/* Onglets */}
      <div className="mb-6 inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
            ].join(" ")}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="rounded-full bg-[var(--accent-muted)] px-1.5 text-[10px] font-semibold text-[var(--accent)]">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

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
        <>
          {activeTab === "missions" && (
            <MissionsTab
              missionCount={missionCount}
              search={search}
              setSearch={setSearch}
              availableFactions={availableFactions}
              selectedFactions={selectedFactions}
              toggleFactionFilter={toggleFactionFilter}
              factionsOpen={factionsOpen}
              setFactionsOpen={setFactionsOpen}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              paginated={paginated}
              filteredCount={filtered.length}
              page={safePage}
              totalPages={totalPages}
              setPage={setCurrentPage}
              favoriteUuids={favoriteUuids}
              objectiveUuids={objectiveUuids}
              onToggleFavorite={toggleFavorite}
              onToggleObjective={toggleObjective}
              onOpen={setModalMission}
            />
          )}

          {activeTab === "objectives" && (
            <ObjectivesTab
              objectives={objectives}
              missions={missions}
              scopes={scopes}
              accountId={accountId}
              onRemove={toggleObjective}
            />
          )}

          {activeTab === "favorites" && (
            <FavoritesTab favorites={favorites} onRemove={toggleFavorite} onSaveNote={saveNote} />
          )}
        </>
      )}

      {modalMission && (
        <MissionModal
          mission={modalMission}
          scopes={scopes}
          accountId={accountId}
          isObjective={objectiveUuids.has(modalMission.uuid)}
          isFavorite={favoriteUuids.has(modalMission.uuid)}
          onToggleObjective={() => toggleObjective(modalMission.uuid)}
          onToggleFavorite={() => toggleFavorite(modalMission.uuid)}
          onClose={() => setModalMission(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Onglet Missions ─────────────────────────── */

function MissionsTab(props: {
  missionCount: number;
  search: string;
  setSearch: (v: string) => void;
  availableFactions: string[];
  selectedFactions: string[];
  toggleFactionFilter: (f: string) => void;
  factionsOpen: boolean;
  setFactionsOpen: (v: boolean) => void;
  sortOrder: SortOrder;
  setSortOrder: (v: SortOrder) => void;
  paginated: MissionListItem[];
  filteredCount: number;
  page: number;
  totalPages: number;
  setPage: (n: number) => void;
  favoriteUuids: Set<string>;
  objectiveUuids: Set<string>;
  onToggleFavorite: (uuid: string) => void;
  onToggleObjective: (uuid: string) => void;
  onOpen: (m: MissionListItem) => void;
}) {
  const { t } = useTranslation();
  if (props.missionCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
        <p className="text-white/70">{t("mission.emptyCatalog")}</p>
        <Link
          to="/settings"
          className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("mission.goToSettings")}
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Barre filtres */}
      <div className="mb-5 flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder={t("missionIntel.filter.searchPlaceholder")}
            className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Factions — dropdown multi-select stylé (accent ambre, glassmorphisme) */}
          <div className="relative">
            <button
              onClick={() => props.setFactionsOpen(!props.factionsOpen)}
              className={[
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                props.selectedFactions.length > 0
                  ? "text-accent"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
              ].join(" ")}
              style={
                props.selectedFactions.length > 0
                  ? { borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)" }
                  : undefined
              }
            >
              <span>
                {props.selectedFactions.length > 0
                  ? t("mission.factionsCount", { n: props.selectedFactions.length })
                  : t("mission.allFactions")}
              </span>
              <ChevronDown
                className={["h-4 w-4 transition-transform", props.factionsOpen ? "rotate-180" : ""].join(" ")}
              />
            </button>
            {props.factionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => props.setFactionsOpen(false)} />
                <div
                  className="absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border backdrop-blur-2xl"
                  style={{ background: "rgba(16,18,24,0.95)", borderColor: "color-mix(in oklab, var(--accent) 18%, transparent)" }}
                >
                  {props.selectedFactions.length > 0 && (
                    <button
                      onClick={() => props.selectedFactions.forEach((f) => props.toggleFactionFilter(f))}
                      className="flex w-full items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:bg-white/5"
                    >
                      {t("mission.deselectAll")}
                      <span className="text-accent/80">{props.selectedFactions.length}</span>
                    </button>
                  )}
                  <div className="max-h-72 overflow-y-auto p-1">
                    {props.availableFactions.map((f) => {
                      const checked = props.selectedFactions.includes(f);
                      return (
                        <button
                          key={f}
                          onClick={() => props.toggleFactionFilter(f)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
                        >
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold"
                            style={
                              checked
                                ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#000" }
                                : { borderColor: "rgba(255,255,255,0.25)" }
                            }
                          >
                            {checked ? "✓" : ""}
                          </span>
                          <span className="truncate">{f}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <Dropdown
            value={props.sortOrder}
            onChange={(v) => props.setSortOrder(v as SortOrder)}
            className="ml-auto w-44"
            buttonClassName="rounded-full"
            options={[
              { value: "rep_desc", label: t("mission.sortRepDesc") },
              { value: "duration_asc", label: t("mission.sortDurationAsc") },
              { value: "alpha", label: t("missionIntel.filter.sortAlpha") },
            ]}
          />
        </div>
      </div>

      {/* Grille */}
      {props.paginated.length === 0 ? (
        <p className="text-sm text-white/40">{t("missionIntel.noResults")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {props.paginated.map((m) => (
            <MissionCard
              key={m.uuid}
              mission={m}
              isFavorite={props.favoriteUuids.has(m.uuid)}
              onToggleFavorite={() => props.onToggleFavorite(m.uuid)}
              onClick={() => props.onOpen(m)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {props.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-1">
          <PageBtn disabled={props.page === 1} onClick={() => props.setPage(props.page - 1)}>‹</PageBtn>
          {Array.from({ length: props.totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === props.totalPages || Math.abs(p - props.page) <= 2)
            .map((p, idx, arr) => (
              <span key={p} className="flex items-center">
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-white/30">…</span>}
                <PageBtn active={p === props.page} onClick={() => props.setPage(p)}>
                  {p}
                </PageBtn>
              </span>
            ))}
          <PageBtn disabled={props.page === props.totalPages} onClick={() => props.setPage(props.page + 1)}>›</PageBtn>
        </div>
      )}
    </>
  );
}

function PageBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm transition-colors disabled:opacity-30",
        active ? "border-indigo-500/30 bg-indigo-500/20 text-white" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function MissionCard({
  mission,
  isFavorite,
  onToggleFavorite,
  onClick,
}: {
  mission: MissionListItem;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const fam = FAMILY[mapScopeFamily(mission)];
  const icon = scopeIcon(mission.rewardScope);
  const isDatamined = mission.source === "datamining";
  const showScope = mission.rewardScope != null && mission.rewardScope !== "Other";

  const meta: string[] = [];
  if (mission.factionName) meta.push(mission.factionName);
  if (mission.minStandingValue) meta.push(renderStars(deriveStarRating(mission.minStandingValue)));
  if (mission.timeMins != null) meta.push(t("mission.minutes", { count: mission.timeMins }));

  return (
    <article
      onClick={onClick}
      className="group flex cursor-pointer items-stretch gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:border-accent/30 hover:bg-accent/[0.04]"
    >
      {/* Icône famille */}
      <div
        className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-xl border text-xl"
        style={{ color: fam.color, background: fam.bg, borderColor: fam.border }}
      >
        {icon}
        {isDatamined && (
          <span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full"
            style={{ background: "#f87171", boxShadow: "0 0 6px rgba(248,113,113,0.85)" }}
            title={t("mission.dataminedTitle")}
          />
        )}
      </div>

      {/* Corps */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{mission.title}</div>
        {meta.length > 0 && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-white/45">{meta.join(" · ")}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {showScope && (
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase"
              style={{ color: fam.color, background: fam.bg, border: `1px solid ${fam.border}` }}
            >
              {mission.rewardScope}
            </span>
          )}
          {mission.illegal && (
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase"
              style={{ color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)" }}
            >
              {t("mission.badgeIllegal")}
            </span>
          )}
          {mission.hasBlueprints && (
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase"
              style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}
            >
              {t("mission.badgeLoot")}
            </span>
          )}
        </div>
      </div>

      {/* Colonne droite */}
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {mission.reputationAmount != null ? (
          <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
            +{mission.reputationAmount.toLocaleString("fr-FR")} {t("mission.repSuffix")}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            title={isFavorite ? t("missionIntel.card.removeFavorite") : t("missionIntel.card.addFavorite")}
            className="text-base leading-none transition-transform hover:scale-110"
            style={{ color: isFavorite ? "var(--accent)" : "rgba(255,255,255,0.4)" }}
          >
            {isFavorite ? "★" : "☆"}
          </button>
          <span
            className="font-mono text-[11px] font-semibold uppercase transition-colors group-hover:text-accent"
            style={{ color: "color-mix(in oklab, var(--accent) 70%, transparent)" }}
          >
            {t("mission.viewArrow")}
          </span>
        </div>
      </div>
    </article>
  );
}

/* ─────────────────────────── Onglet Objectifs ─────────────────────────── */

// Famille (couleur du badge) déduite du seul libellé de scope (l'objectif n'a pas les
// drapeaux hasCombat/… d'une MissionListItem). Variante simplifiée de mapScopeFamily.
function familyFromScopeText(scope: string | null): ScopeFamily {
  const s = (scope ?? "").toLowerCase();
  if (
    s.includes("combat") || s.includes("assassin") || s.includes("bounty") ||
    s.includes("patrol") || s.includes("elimin") || s.includes("murder") ||
    s.includes("hunt") || s.includes("security")
  )
    return "combat";
  if (s.includes("salvage")) return "salvage";
  if (s.includes("recovery") || s.includes("rescue") || s.includes("retrieval")) return "recovery";
  if (s.includes("hauling")) return "hauling";
  if (s.includes("cargo") || s.includes("delivery") || s.includes("transport")) return "cargo";
  return "other";
}

/* ── Reco de farm (port fidèle de missionHelpers.ts V1) ── */

// Meilleure mission à farmer : parmi les missions publiées de la MÊME faction avec
// reputationAmount>0 et timeMins>0, celle au plus haut ratio réputation/minute.
export function findOptimalMission(
  allMissions: MissionListItem[],
  factionUuid: string | null,
): MissionListItem | null {
  if (!factionUuid) return null;
  const candidates = allMissions.filter(
    (m) =>
      m.released &&
      m.factionUuid === factionUuid &&
      m.reputationAmount != null &&
      m.reputationAmount > 0 &&
      m.timeMins != null &&
      m.timeMins > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) => {
    const bRate = (best.reputationAmount ?? 0) / (best.timeMins ?? Infinity);
    const mRate = (m.reputationAmount ?? 0) / (m.timeMins ?? Infinity);
    return mRate > bRate ? m : best;
  });
}

// Nombre de runs pour combler la réputation manquante (0 si déjà atteint, ∞ si rep/run≤0).
export function computeRepeatsNeeded(target: number, current: number, perRun: number): number {
  if (current >= target) return 0;
  if (perRun <= 0) return Infinity;
  return Math.ceil((target - current) / perRun);
}

// Temps total de farm en minutes (runs × durée d'un run).
export function computeTotalFarmTime(repeats: number, durMinsPerRun: number): number {
  if (repeats === 0) return 0;
  return repeats * durMinsPerRun;
}

function ObjectiveCard({
  objective,
  missions,
  scopes,
  accountId,
  onRemove,
}: {
  objective: ObjectiveItem;
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  onRemove: (uuid: string) => void;
}) {
  const { t } = useTranslation();
  const fam = FAMILY[familyFromScopeText(objective.rewardScope)];
  const category = objective.rewardScope ?? "—";

  // Réputation déclarée remontée par le ReputationPanel (Lot 1), pour évaluer le prérequis.
  const [declaredRep, setDeclaredRep] = useState<number | null>(null);
  // Le scope existe-t-il (échelle de grades) ? Sinon la réputation n'est pas suivie → pas
  // de verdict atteint/reste possible.
  const scopeName = mapRewardScopeToScopeName(objective.rewardScope);
  const hasScope = !!(scopeName && scopes.some((s) => s.scopeName === scopeName));

  const reqValue = objective.minStandingValue;
  const hasPrereq = reqValue != null && reqValue > 0;
  const declared = declaredRep ?? 0;
  const reqMet = hasPrereq && declared >= (reqValue as number);
  const remaining = hasPrereq ? Math.max(0, (reqValue as number) - declared) : 0;

  // Reco de farm : candidates = missions de la même faction que la mission-objectif.
  // factionUuid récupéré par jointure front (la liste complète est chargée au mount).
  const factionUuid =
    missions.find((m) => m.uuid === objective.uuid)?.factionUuid ?? null;
  const optimal = useMemo(
    () => findOptimalMission(missions, factionUuid),
    [missions, factionUuid],
  );
  const farmTarget = reqValue ?? 0; // réputation visée = prérequis de la mission-objectif
  const perRun = optimal?.reputationAmount ?? 0;
  const repeats = optimal ? computeRepeatsNeeded(farmTarget, declared, perRun) : 0;
  const totalFarmHours = computeTotalFarmTime(repeats, optimal?.timeMins ?? 0) / 60;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span
            className="inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: fam.color, background: fam.bg, border: `1px solid ${fam.border}` }}
          >
            {scopeIcon(objective.rewardScope)} {category}
          </span>
          <p className="mt-1.5 truncate font-medium text-white">{objective.title}</p>
          {objective.factionName && (
            <p className="truncate text-sm text-white/50">{objective.factionName}</p>
          )}
        </div>
        <button
          onClick={() => onRemove(objective.uuid)}
          className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
        >
          {t("action.remove")}
        </button>
      </div>

      {/* Prérequis : grade min requis + état (atteint / reste à gagner), comparé à la
          réputation déclarée (Lot 2). État purement dérivé de la réputation, comme V1. */}
      <div className="border-t border-white/5 pt-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          {t("mission.prereq")}
        </p>
        {!hasPrereq ? (
          <p className="text-sm italic text-white/40">{t("mission.noPrereq")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/80">
              🔒 {objective.factionName ? `${objective.factionName} : ` : ""}
              <strong className="text-white">{objective.minStandingName ?? "—"}</strong> (
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
              <span className="text-xs text-accent">
                {t("mission.repStillNeeded", { rep: remaining.toLocaleString("fr-FR") })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Progression de grade (panneau factorisé). Si le scope n'a pas d'échelle de
          grades (Investigation/Mining/Salvage/Recovery/Other…), message au lieu d'une barre. */}
      <div className="border-t border-white/5 pt-3">
        <ReputationPanel
          rewardScope={objective.rewardScope}
          accountId={accountId}
          scopes={scopes}
          noScopeLabel={t("mission.noGradesCategory")}
          onReputation={setDeclaredRep}
        />
      </div>

      {/* Reco de farm : UNE meilleure mission (rep/min), runs + temps pour combler la
          réputation manquante. Calculable même sans échelle de grades. */}
      <div className="border-t border-white/5 pt-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          {t("mission.bestFarmMission")}
        </p>
        {!optimal ? (
          <p className="text-sm italic text-white/40">{t("mission.noMissionForFaction")}</p>
        ) : (
          <div
            className="rounded-xl border px-3 py-2"
            style={{ borderColor: "color-mix(in oklab, var(--accent) 25%, transparent)", background: "color-mix(in oklab, var(--accent) 6%, transparent)" }}
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
            {repeats === 0 && (
              <p className="mt-1 text-xs font-semibold" style={{ color: "#34d399" }}>
                {t("mission.objectiveReached")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectivesTab({
  objectives,
  missions,
  scopes,
  accountId,
  onRemove,
}: {
  objectives: ObjectiveItem[];
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  onRemove: (uuid: string) => void;
}) {
  const { t } = useTranslation();
  if (objectives.length === 0) {
    return <p className="text-sm text-white/40">{t("mission.noObjectives")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {objectives.map((o) => (
        <ObjectiveCard
          key={o.uuid}
          objective={o}
          missions={missions}
          scopes={scopes}
          accountId={accountId}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────── Onglet Favoris ─────────────────────────── */

function FavoritesTab({
  favorites,
  onRemove,
  onSaveNote,
}: {
  favorites: FavoriteItem[];
  onRemove: (uuid: string) => void;
  onSaveNote: (uuid: string, note: string) => void;
}) {
  const { t } = useTranslation();
  if (favorites.length === 0) {
    return <p className="text-sm text-white/40">{t("mission.noFavorites")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {favorites.map((f) => (
        <div
          key={f.uuid}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">{f.title}</p>
            <p className="truncate text-sm text-white/50">{f.factionName ?? "—"}</p>
            <input
              defaultValue={f.note ?? ""}
              placeholder={t("mission.notePlaceholder")}
              onBlur={(e) => {
                if ((e.target.value || "") !== (f.note ?? "")) onSaveNote(f.uuid, e.target.value);
              }}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
            />
          </div>
          <button
            onClick={() => onRemove(f.uuid)}
            className="shrink-0 self-start rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
          >
            {t("action.remove")}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Modal détail ─────────────────────────── */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {title}
      </h3>
      {children}
    </section>
  );
}

/* ─────────────────── Panneau Réputation (factorisé) ───────────────────
   Machine à états Scope/Rank réutilisée par le modal de détail ET les cartes
   de l'onglet Objectifs (mission→scope via rewardScope + SCOPE_NAME_MAP, jamais
   la FK scopeId qui n'est pas peuplée). Réputation saisie à la main, persistée
   par compte + par scope (set_scope_progress) — donc partagée entre le détail et
   l'onglet pour un même scope. */
export function ReputationPanel({
  rewardScope,
  accountId,
  scopes,
  noScopeLabel,
  onReputation,
}: {
  rewardScope: string | null;
  accountId: string;
  scopes: ScopeWithRanks[];
  noScopeLabel?: string;
  // Remonte la réputation déclarée (null = non déclarée / inconnue) à chaque (re)chargement
  // ou enregistrement. Sert au prérequis de la carte Objectif (Lot 2). Le modal n'en a pas besoin.
  onReputation?: (rep: number | null) => void;
}) {
  const { t } = useTranslation();
  const noScopeText = noScopeLabel ?? t("mission.noScopeForMission");
  const scopeName = mapRewardScopeToScopeName(rewardScope);
  const scope = scopeName ? scopes.find((s) => s.scopeName === scopeName) ?? null : null;
  // undefined = chargement ; null = non déclarée ; objet = déclarée.
  const [repProgress, setRepProgress] = useState<ScopeProgress | null | undefined>(undefined);
  const [repEditing, setRepEditing] = useState(false);
  const [repRankId, setRepRankId] = useState("");
  const [repXP, setRepXP] = useState(0);
  const [repSaving, setRepSaving] = useState(false);

  useEffect(() => {
    if (!scope) {
      setRepProgress(null);
      return;
    }
    let cancelled = false;
    setRepProgress(undefined);
    setRepEditing(false);
    invoke<ScopeProgress | null>("get_scope_progress", { accountId, scopeId: scope.id })
      .then((p) => {
        if (!cancelled) setRepProgress(p);
      })
      .catch(() => {
        if (!cancelled) setRepProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scope?.id, accountId]);

  const rankComp = useMemo(
    () => (repProgress && scope ? computeCurrentRank(repProgress.currentReputation, scope.ranks) : null),
    [repProgress, scope],
  );

  // Remonte la réputation déclarée au parent (carte Objectif) dès qu'elle change.
  // undefined (chargement) → on ne remonte rien encore ; null (non déclarée) → null.
  useEffect(() => {
    if (repProgress === undefined) return;
    onReputation?.(repProgress ? repProgress.currentReputation : null);
  }, [repProgress, onReputation]);

  // Rangs sélectionnables : on exclut les rangs négatifs (Hostile), triés par rankIndex.
  const selectableRanks = useMemo(
    () =>
      scope
        ? [...scope.ranks].filter((r) => r.minReputation >= 0).sort((a, b) => a.rankIndex - b.rankIndex)
        : [],
    [scope],
  );
  const selIdx = selectableRanks.findIndex((r) => r.id === repRankId);
  const selRank = selIdx >= 0 ? selectableRanks[selIdx] : null;
  const nextSelRank = selIdx >= 0 ? selectableRanks[selIdx + 1] ?? null : null;
  // Étendue d'XP dans le rang = seuil du rang suivant − seuil du rang choisi. null au dernier rang.
  const maxXP = selRank && nextSelRank ? nextSelRank.minReputation - selRank.minReputation : null;

  // Ouvre l'édition en pré-remplissant le rang + la position dans le rang depuis la progression courante.
  function startEditing() {
    if (repProgress && rankComp?.currentRank) {
      const cur = rankComp.currentRank;
      setRepRankId(cur.id);
      setRepXP(Math.max(0, repProgress.currentReputation - cur.minReputation));
    } else {
      setRepRankId(selectableRanks[0]?.id ?? "");
      setRepXP(0);
    }
    setRepEditing(true);
  }

  async function saveRep() {
    if (!scope || !selRank) return;
    // Rep totale stockée = seuil du rang choisi + position dans le rang (0 au dernier rang).
    const total = selRank.minReputation + (maxXP != null ? Math.min(repXP, maxXP) : 0);
    setRepSaving(true);
    try {
      const p = await invoke<ScopeProgress>("set_scope_progress", {
        accountId,
        scopeId: scope.id,
        currentReputation: total,
      });
      setRepProgress(p);
      setRepEditing(false);
    } catch {
      /* ignore */
    } finally {
      setRepSaving(false);
    }
  }

  if (!scope) {
    return <p className="text-sm italic text-white/40">{noScopeText}</p>;
  }
  if (repProgress === undefined) {
    return <p className="text-sm text-white/40">…</p>;
  }
  if (repEditing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-wider text-white/40">{t("mission.rank")}</label>
          <Dropdown
            value={repRankId}
            onChange={(v) => {
              setRepRankId(v);
              setRepXP(0);
            }}
            ariaLabel={t("mission.rank")}
            options={selectableRanks.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>

        {maxXP != null ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label className="text-[11px] uppercase tracking-wider text-white/40">
                {t("mission.rankProgress")}
              </label>
              <span className="text-[11px] tabular-nums text-white/70">
                {t("mission.rankXp", {
                  current: Math.min(repXP, maxXP).toLocaleString("fr-FR"),
                  max: maxXP.toLocaleString("fr-FR"),
                })}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxXP}
              step={1}
              value={Math.min(repXP, maxXP)}
              onChange={(e) => setRepXP(parseInt(e.target.value, 10))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        ) : (
          <p className="text-[11px] italic text-white/40">
            {t("mission.rankMaxNoProgress")}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void saveRep()}
            disabled={repSaving || !selRank}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)" }}
          >
            {repSaving ? "…" : t("mission.ok")}
          </button>
          <button
            onClick={() => setRepEditing(false)}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-white/50 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }
  if (repProgress === null) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm italic text-white/40">{t("missionIntel.repUndeclared")}</span>
        <button
          onClick={startEditing}
          className="rounded-full border border-dashed border-white/25 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/60 transition-colors hover:border-accent/50 hover:text-accent"
        >
          {t("mission.declare")}
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={startEditing}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]"
      >
        <span className="font-semibold" style={{ color: "var(--accent)" }}>
          {rankComp?.currentRank?.name ?? "—"}
        </span>
        <span className="text-white/30">·</span>
        <span className="tabular-nums text-white/80">
          {t("mission.repValue", { rep: repProgress.currentReputation.toLocaleString("fr-FR") })}
        </span>
        <span className="ml-auto text-white/40">✎</span>
      </button>
      {rankComp && (
        <div className="mt-2">
          <div className="mb-1.5 text-[11px] text-white/50">
            {rankComp.nextRank ? (
              <>
                {rankComp.currentRank?.name} → {rankComp.nextRank.name} ·{" "}
                <strong className="text-white/80">
                  {t("mission.repRemaining", { rep: rankComp.repToNextRank.toLocaleString("fr-FR") })}
                </strong>
              </>
            ) : (
              <span style={{ color: "#34d399" }}>{t("mission.rankMaxReached")}</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${rankComp.progressPercent}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export function MissionModal({
  mission,
  scopes,
  accountId,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  onClose,
}: {
  mission: MissionListItem;
  scopes: ScopeWithRanks[];
  accountId: string;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const subtitleParts: string[] = [];
  if (mission.factionName) subtitleParts.push(mission.factionName);
  subtitleParts.push(deriveTierLabel(mission.minStandingValue, t));
  const subtitle = subtitleParts.join(" · ");

  const uecPerHour = calculateUecPerHour(mission);
  const showDesc = isCleanDescription(mission.description);
  const wikiUrl = mission.webUrl ?? `https://star-citizen.wiki/Mission/${mission.uuid}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(16,18,24,0.95)", borderColor: "color-mix(in oklab, var(--accent) 18%, transparent)" }}
      >
        {/* En-tête */}
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">{mission.title}</h2>
            <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

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
          {mission.minStandingName && mission.minStandingValue ? (
            <div className="flex items-center gap-2 text-sm text-white/80">
              <span>🔒</span>
              <span>
                {mission.factionName ? `${mission.factionName} : ` : ""}
                <strong className="text-white">{mission.minStandingName}</strong> (
                {t("mission.repParen", { rep: mission.minStandingValue.toLocaleString("fr-FR") })})
              </span>
            </div>
          ) : (
            <p className="text-sm italic text-white/40">{t("mission.noPrereq")}</p>
          )}
        </Section>

        {/* Réputation — panneau factorisé (machine à états Scope/Rank) */}
        <Section title={t("mission.reputation")}>
          <ReputationPanel rewardScope={mission.rewardScope} accountId={accountId} scopes={scopes} />
        </Section>

        {/* Drops possibles */}
        {mission.hasBlueprints && mission.blueprints.length > 0 && (
          <Section title={t("mission.drops")}>
            <ul className="flex flex-col gap-1">
              {mission.blueprints.map((b) => (
                <li key={b.itemUuid} className="flex items-center gap-2 text-sm text-white/75">
                  <span style={{ color: "var(--accent)" }}>◆</span>
                  {b.name}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Description */}
        {showDesc && (
          <Section title={t("mission.description")}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
              {mission.description}
            </p>
          </Section>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={onToggleObjective}
            className={[
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              isObjective
                ? "border text-[#60a5fa]"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
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
              isFavorite
                ? "border text-accent"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            ].join(" ")}
            style={isFavorite ? { borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)" } : undefined}
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
      </div>
    </div>
  );
}
