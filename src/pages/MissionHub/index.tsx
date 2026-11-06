import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { Crosshair, Loader2 } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { SidePanelLayout } from "../../components/ui/SidePanel";
import { ShowMore } from "../../components/ui/ShowMore";
import { FavoriteItem, FicheTab, ListFilter, MissionListItem, ObjectiveItem, ScopeWithRanks, SortOrder } from "./helpers";
import { filterMissions, missionCounts, sortMissions } from "./lib/missionView";
import { MissionToolbar } from "./components/MissionToolbar";
import { MissionTable } from "./components/MissionTable";
import { MissionFiche } from "./components/MissionFiche";

const STEP = 50;

/* Mission Hub (maquette docs/design/maquettes-refonte-pages-2.html, variante A) : filtres en haut,
   tableau des missions, fiche fixe à droite à 2 onglets (Détails = réputation, farm, objectif ;
   Drop = plans → Crafting). Logique de liste dans lib/missionView.ts, métier dans helpers.ts. */

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
  const [limit, setLimit] = useState(STEP);

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

  // ── Liste : filtres, tri, compteurs ──
  const filtered = useMemo(
    () => sortMissions(filterMissions(missions, { q: search, factions: selectedFactions, listFilter, objectives: objectiveUuids, favorites: favoriteUuids }), sortOrder),
    [missions, search, selectedFactions, listFilter, objectiveUuids, favoriteUuids, sortOrder],
  );
  const counts = useMemo(() => missionCounts(missions, objectiveUuids, favoriteUuids), [missions, objectiveUuids, favoriteUuids]);
  useEffect(() => setLimit(STEP), [search, selectedFactions, sortOrder, listFilter]);
  const selected = filtered.find((m) => m.uuid === selectedUuid) ?? filtered[0] ?? null;

  function selectMission(uuid: string) {
    setSelectedUuid(uuid);
    setFicheTab("details");
  }

  return (
    <div className="p-8">
      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("mission.loading")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("mission.errorPrefix")} {error}
        </p>
      ) : missions.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title={t("empty.mission.title")}
          text={t("empty.mission.text")}
          action={{ label: t("empty.mission.action"), onClick: () => navigate("/settings#donnees") }}
        />
      ) : (
        <>
          <MissionToolbar
            search={search}
            setSearch={setSearch}
            factions={availableFactions}
            selectedFactions={selectedFactions}
            setSelectedFactions={setSelectedFactions}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            listFilter={listFilter}
            setListFilter={setListFilter}
            counts={counts}
            t={t}
          />
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/40">{t("mission.noResults")}</p>
          ) : (
            <SidePanelLayout
              panel={
                selected && (
                  <div className="-m-4 flex min-h-0 flex-1 flex-col">
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
                  </div>
                )
              }
            >
              <div className="glass overflow-x-auto rounded-2xl px-1.5 py-1">
                <MissionTable missions={filtered.slice(0, limit)} selectedUuid={selected?.uuid ?? null} favorites={favoriteUuids} onSelect={(m) => selectMission(m.uuid)} t={t} />
                <ShowMore rest={filtered.length - limit} step={STEP} onMore={() => setLimit((l) => l + STEP)} />
              </div>
            </SidePanelLayout>
          )}
        </>
      )}
    </div>
  );
}
