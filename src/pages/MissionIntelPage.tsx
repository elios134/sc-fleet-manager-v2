import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Search, Star, Target, X } from "lucide-react";

/* ── Types (identiques à la V1 MissionListItem) ── */

type MissionListItem = {
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

type ObjectiveItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  status: string | null;
  notes: string | null;
  updatedAt: string | null;
};

type FavoriteItem = {
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

const TYPE_CHIPS = ["Cargo", "Combat", "Mining", "Salvage", "ILLEGAL"];
const PER_PAGE = 20;

function missionMatchesTypes(m: MissionListItem, types: string[]): boolean {
  if (types.length === 0) return true;
  return types.some((t) => {
    if (t === "Cargo") return m.rewardScope === "Cargo" || m.rewardScope === "Cargo Transport";
    if (t === "Combat") return m.rewardScope === "Combat" || m.rewardScope === "Combat Assist";
    if (t === "ILLEGAL") return m.illegal === true;
    return m.rewardScope === t;
  });
}

export default function MissionIntelPage() {
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [availableFactions, setAvailableFactions] = useState<string[]>([]);
  const [missionCount, setMissionCount] = useState(0);

  const [accountId, setAccountId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("missions");
  const [search, setSearch] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
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
        const [missionsData, factionsData, objData, favData, status] = await Promise.all([
          invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }),
          invoke<string[]>("get_distinct_factions"),
          invoke<ObjectiveItem[]>("list_objectives", { accountId: acc }),
          invoke<FavoriteItem[]>("list_favorites", { accountId: acc }),
          invoke<MissionsStatus>("get_missions_status"),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setMissions(missionsData);
        setAvailableFactions(factionsData);
        setObjectives(objData);
        setFavorites(favData);
        setMissionCount(status.missionCount);
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
  const filtered = useMemo(() => {
    let list = missions.filter((m) => m.released);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.factionName?.toLowerCase().includes(q) ?? false),
      );
    }
    if (selectedTypes.length > 0) list = list.filter((m) => missionMatchesTypes(m, selectedTypes));
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
  }, [missions, search, selectedTypes, selectedFactions, sortOrder]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedTypes, selectedFactions, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }
  function toggleFactionFilter(faction: string) {
    setSelectedFactions((prev) =>
      prev.includes(faction) ? prev.filter((f) => f !== faction) : [...prev, faction],
    );
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: "missions", label: "Missions" },
    { key: "objectives", label: "Objectifs", badge: objectives.length },
    { key: "favorites", label: "Favoris", badge: favorites.length },
  ];

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Star Citizen</p>
        <h1 className="text-2xl font-bold text-white">MISSION INTEL</h1>
      </header>

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
          Chargement…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Erreur : {error}
        </p>
      ) : (
        <>
          {activeTab === "missions" && (
            <MissionsTab
              missionCount={missionCount}
              search={search}
              setSearch={setSearch}
              selectedTypes={selectedTypes}
              toggleType={toggleType}
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
            <ObjectivesTab objectives={objectives} onRemove={toggleObjective} />
          )}

          {activeTab === "favorites" && (
            <FavoritesTab favorites={favorites} onRemove={toggleFavorite} onSaveNote={saveNote} />
          )}
        </>
      )}

      {modalMission && (
        <MissionModal
          mission={modalMission}
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
  selectedTypes: string[];
  toggleType: (t: string) => void;
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
  if (props.missionCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
        <p className="text-white/70">Catalogue vide — synchronisez depuis Settings</p>
        <Link
          to="/settings"
          className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Aller dans Settings
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
            placeholder="Rechercher une mission…"
            className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip active={props.selectedTypes.length === 0} onClick={() => props.selectedTypes.forEach((t) => props.toggleType(t))}>
            Tous
          </Chip>
          {TYPE_CHIPS.map((type) => (
            <Chip key={type} active={props.selectedTypes.includes(type)} onClick={() => props.toggleType(type)}>
              {type}
            </Chip>
          ))}

          {/* Factions dropdown */}
          <div className="relative">
            <button
              onClick={() => props.setFactionsOpen(!props.factionsOpen)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
            >
              Factions{props.selectedFactions.length > 0 ? ` (${props.selectedFactions.length})` : ""}
            </button>
            {props.factionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => props.setFactionsOpen(false)} />
                <div
                  className="absolute left-0 z-50 mt-2 max-h-72 w-56 overflow-y-auto rounded-2xl border p-1 backdrop-blur-2xl"
                  style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
                >
                  {props.availableFactions.map((f) => (
                    <label
                      key={f}
                      className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
                    >
                      <input
                        type="checkbox"
                        checked={props.selectedFactions.includes(f)}
                        onChange={() => props.toggleFactionFilter(f)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="truncate">{f}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <select
            value={props.sortOrder}
            onChange={(e) => props.setSortOrder(e.target.value as SortOrder)}
            className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:outline-none"
          >
            <option value="rep_desc" className="bg-[#14141c]">Réputation ↓</option>
            <option value="duration_asc" className="bg-[#14141c]">Durée ↑</option>
            <option value="alpha" className="bg-[#14141c]">Alphabétique</option>
          </select>
        </div>
      </div>

      {/* Grille */}
      {props.paginated.length === 0 ? (
        <p className="text-sm text-white/40">Aucune mission ne correspond aux filtres.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {props.paginated.map((m) => (
            <MissionCard
              key={m.uuid}
              mission={m}
              isFavorite={props.favoriteUuids.has(m.uuid)}
              isObjective={props.objectiveUuids.has(m.uuid)}
              onToggleFavorite={() => props.onToggleFavorite(m.uuid)}
              onToggleObjective={() => props.onToggleObjective(m.uuid)}
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-indigo-500/30 bg-indigo-500/20 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
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
  isObjective,
  onToggleFavorite,
  onToggleObjective,
  onClick,
}: {
  mission: MissionListItem;
  isFavorite: boolean;
  isObjective: boolean;
  onToggleFavorite: () => void;
  onToggleObjective: () => void;
  onClick: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{mission.title}</h3>
          {mission.factionName && (
            <p className="truncate text-sm text-white/50">{mission.factionName}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggleFavorite}
            title="Favori"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-amber-400"
          >
            <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={onToggleObjective}
            title="Objectif"
            className={[
              "rounded-lg p-1.5 hover:bg-white/10",
              isObjective ? "text-[var(--accent)]" : "text-white/50 hover:text-[var(--accent)]",
            ].join(" ")}
          >
            <Target className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mission.rewardScope && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
            {mission.rewardScope}
          </span>
        )}
        {mission.illegal && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
            ILLEGAL
          </span>
        )}
        {mission.reputationAmount != null && mission.reputationAmount > 0 && (
          <span className="text-[11px] font-semibold text-amber-400">
            +{mission.reputationAmount} rep
          </span>
        )}
        {mission.timeMins != null && (
          <span className="text-[11px] text-white/40">{mission.timeMins} min</span>
        )}
      </div>
    </article>
  );
}

/* ─────────────────────────── Onglet Objectifs ─────────────────────────── */

function ObjectivesTab({
  objectives,
  onRemove,
}: {
  objectives: ObjectiveItem[];
  onRemove: (uuid: string) => void;
}) {
  if (objectives.length === 0) {
    return <p className="text-sm text-white/40">Aucun objectif suivi.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {objectives.map((o) => (
        <div
          key={o.uuid}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">{o.title}</p>
            <p className="truncate text-sm text-white/50">
              {o.factionName ?? "—"}
              {o.status ? ` · ${o.status}` : ""}
              {o.updatedAt ? ` · maj ${o.updatedAt}` : ""}
            </p>
          </div>
          <button
            onClick={() => onRemove(o.uuid)}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
          >
            Retirer
          </button>
        </div>
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
  if (favorites.length === 0) {
    return <p className="text-sm text-white/40">Aucun favori.</p>;
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
              placeholder="Note…"
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
            Retirer
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Modal détail ─────────────────────────── */

function MissionModal({
  mission,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  onClose,
}: {
  mission: MissionListItem;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-white">{mission.title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {mission.description && <p className="mb-4 text-sm text-white/70">{mission.description}</p>}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Faction" value={mission.factionName} />
          <Field label="Type" value={mission.rewardScope} />
          <Field label="Durée" value={mission.timeMins != null ? `${mission.timeMins} min` : null} />
          <Field
            label="Réputation"
            value={mission.reputationAmount != null ? `+${mission.reputationAmount}` : null}
          />
          <Field label="Systèmes" value={mission.starSystems} />
          <Field label="Version" value={mission.gameVersion} />
        </dl>

        {mission.hasBlueprints && mission.blueprints.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Blueprints</p>
            <ul className="flex flex-col gap-1">
              {mission.blueprints.map((b) => (
                <li key={b.itemUuid} className="text-sm text-white/70">
                  • {b.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onToggleObjective}
            className={[
              "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              isObjective
                ? "bg-[var(--accent)] text-white"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            ].join(" ")}
          >
            <Target className="h-4 w-4" />
            {isObjective ? "Objectif suivi" : "Suivre"}
          </button>
          <button
            onClick={onToggleFavorite}
            className={[
              "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              isFavorite
                ? "bg-amber-500/20 text-amber-300"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            ].join(" ")}
          >
            <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
            {isFavorite ? "Favori" : "Ajouter aux favoris"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="text-white/80">{value ?? "—"}</dd>
    </div>
  );
}
