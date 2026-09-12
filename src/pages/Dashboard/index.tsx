import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { catchLog } from "../../lib/logError";
import { useTranslation } from "react-i18next";
import { Pencil, Check, RefreshCw, RotateCcw } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import logo from "../../assets/logo.png";
import { type InsuranceShip } from "../../lib/insurance";
import { MissionModal, type MissionListItem, type ScopeWithRanks } from "../missionShared";
import { rentalDaysLeft } from "../../components/ShipCard";
import { useDatamining } from "../../contexts/DataminingContext";
import { type Placed, type DashCore, type CcuShip, type ShipRow, type RentedShip, type TopRoutesResult, type RsiServerStatus, type NewsItem, type DashData } from "./types";
import { LAYOUT_META_KEY, WIDGETS } from "./widgets";
import { defaultPos } from "./helpers";
import { EmptyState } from "./components/EmptyState";
import { FreeWidget } from "./components/FreeWidget";
import { WidgetLibraryModal } from "./components/WidgetLibraryModal";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [data, setData] = useState<DashData | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // État pour la modale de mission ouverte DANS le dashboard.
  const [accountId, setAccountId] = useState("");
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [objectiveUuids, setObjectiveUuids] = useState<Set<string>>(new Set());
  const [favoriteUuids, setFavoriteUuids] = useState<Set<string>>(new Set());
  const [modalMission, setModalMission] = useState<MissionListItem | null>(null);

  // Onboarding (premier setup) : le Dashboard se contente de SIGNALER le déclencheur
  // `firstLogin` (posé par finalizeRsiLogin) au contexte global. L'orchestration,
  // l'état (étapes/started/done) et la modale vivent au niveau global (provider +
  // Layout) → ils survivent aux changements d'onglet. triggerOnboarding est idempotent.
  const location = useLocation();
  const { triggerOnboarding } = useDatamining();
  useEffect(() => {
    if ((location.state as { firstLogin?: boolean } | null)?.firstLogin === true) {
      triggerOnboarding();
    }
  }, [location.state, triggerOnboarding]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Recharge les données après une synchronisation RSI.
  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((n) => n + 1));
    return () => {
      void pending.then((un) => un());
    };
  }, []);

  // Lecture de la disposition sauvegardée au montage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<string | null>("get_app_meta", { key: LAYOUT_META_KEY });
        // Défaut VIDE : au 1er lancement (raw == null) comme après un vidage volontaire
        // (raw = "[]"), le dashboard reste vide — l'utilisateur choisit ses widgets.
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const seen = new Set<string>();
            const clean: Placed[] = [];
            parsed.forEach((entry: unknown, i: number) => {
              if (typeof entry === "string") {
                if (entry in WIDGETS && !seen.has(entry)) {
                  seen.add(entry);
                  clean.push({ key: entry, ...defaultPos(clean.length) });
                }
                return;
              }
              if (
                entry &&
                typeof entry === "object" &&
                typeof (entry as Placed).key === "string" &&
                (entry as Placed).key in WIDGETS &&
                !seen.has((entry as Placed).key)
              ) {
                const e = entry as Placed;
                seen.add(e.key);
                clean.push({
                  key: e.key,
                  x: Number.isFinite(e.x) ? e.x : defaultPos(i).x,
                  y: Number.isFinite(e.y) ? e.y : defaultPos(i).y,
                });
              }
            });
            setPlaced(clean);
          }
        }
      } catch {
        // Disposition illisible : dashboard vide.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Chargement des données réelles. Chaque source est tolérante aux pannes :
  // une commande qui échoue ne doit pas vider les autres widgets.
  // Clés des widgets placés (triées, stable) : ne change qu'à l'ajout/retrait d'un widget
  // (pas au drag) → dépendance du chargement paresseux sans refetch pendant le déplacement.
  const placedKeys = placed.map((p) => p.key).sort().join(",");
  useEffect(() => {
    // Chargement paresseux : on attend que la disposition soit connue (loaded) pour ne
    // requêter QUE les données des widgets réellement placés. (placedKeys en dép → l'ajout
    // d'un widget recharge ses données ; le drag — qui ne change pas les clés — ne recharge pas.)
    if (!loaded) return;
    const keys = new Set(placed.map((p) => p.key));
    let cancelled = false;
    (async () => {
      // Indépendants du compte : catalogue missions + scopes (réputation) + statut
      // serveurs RSI + actualités RSI (Phase 0). Chaque source est tolérante aux pannes.
      const [missions, scopesData, rsiStatus, news] = await Promise.all([
        invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }).catch(
          () => [] as MissionListItem[],
        ),
        invoke<ScopeWithRanks[]>("get_scopes").catch(() => [] as ScopeWithRanks[]),
        keys.has("rsiStatus")
          ? invoke<RsiServerStatus>("get_rsi_server_status").catch(() => null)
          : Promise.resolve(null),
        keys.has("news")
          ? invoke<NewsItem[]>("get_rsi_news", { limit: 6, force: reloadTick > 0 }).catch(
              () => [] as NewsItem[],
            )
          : Promise.resolve([] as NewsItem[]),
      ]);

      const acc = await invoke<string | null>("get_active_account_id").catch(() => null);
      if (!cancelled) {
        setScopes(scopesData);
        setAccountId(acc ?? "");
      }

      if (!acc) {
        if (!cancelled) {
          setData({
            core: null,
            insurance: [],
            missions,
            ccuShips: [],
            rentedShips: [],
            topRoutes: null,
            rsiStatus,
            news,
          });
          setObjectiveUuids(new Set());
          setFavoriteUuids(new Set());
          setRefreshing(false);
        }
        return;
      }

      const [core, insurance, ccuShips, allShips, topRoutes, objectives, favorites] =
        await Promise.all([
          invoke<DashCore>("get_dashboard_data", { accountId: acc }).catch(catchLog("dashboard.core", null)),
          keys.has("insurance")
            ? invoke<InsuranceShip[]>("get_insurance_ships", { accountId: acc }).catch(
                catchLog("dashboard.insurance", [] as InsuranceShip[]),
              )
            : Promise.resolve([] as InsuranceShip[]),
          keys.has("ccu")
            ? invoke<CcuShip[]>("get_ccu_ships_metadata", { accountId: acc }).catch(
                catchLog("dashboard.ccu", [] as CcuShip[]),
              )
            : Promise.resolve([] as CcuShip[]),
          keys.has("locations")
            ? invoke<ShipRow[]>("get_ships", { accountId: acc }).catch(catchLog("dashboard.ships", [] as ShipRow[]))
            : Promise.resolve([] as ShipRow[]),
          keys.has("routes")
            ? invoke<TopRoutesResult | null>("get_dashboard_top_routes", { limit: 3 }).catch(
                catchLog("dashboard.routes", null),
              )
            : Promise.resolve(null),
          invoke<{ uuid: string }[]>("list_objectives", { accountId: acc }).catch(
            catchLog("dashboard.objectives", [] as { uuid: string }[]),
          ),
          invoke<{ uuid: string }[]>("list_favorites", { accountId: acc }).catch(
            catchLog("dashboard.favorites", [] as { uuid: string }[]),
          ),
        ]);
      // Loués triés par échéance ASCENDANTE (expirés / plus proches en tête ; sans
      // date → en fin). rentalDaysLeft réutilisé tel quel pour la clé de tri.
      const rentedShips: RentedShip[] = allShips
        .filter((s) => s.acquisition === "rented")
        .map((s) => ({ id: s.id, name: s.name, rentalExpiresAt: s.rentalExpiresAt }))
        .sort((a, b) => {
          const da = rentalDaysLeft(a.rentalExpiresAt);
          const db = rentalDaysLeft(b.rentalExpiresAt);
          return (da ?? Infinity) - (db ?? Infinity);
        });
      if (!cancelled) {
        setData({ core, insurance, missions, ccuShips, rentedShips, topRoutes, rsiStatus, news });
        setObjectiveUuids(new Set(objectives.map((o) => o.uuid)));
        setFavoriteUuids(new Set(favorites.map((f) => f.uuid)));
        setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick, loaded, placedKeys]);

  async function toggleObjective(uuid: string) {
    if (!accountId) return;
    try {
      await invoke("toggle_objective", { accountId, missionUuid: uuid });
      const list = await invoke<{ uuid: string }[]>("list_objectives", { accountId });
      setObjectiveUuids(new Set(list.map((o) => o.uuid)));
    } catch {
      /* ignore */
    }
  }

  async function toggleFavorite(uuid: string) {
    if (!accountId) return;
    try {
      await invoke("toggle_favorite", { accountId, missionUuid: uuid });
      const list = await invoke<{ uuid: string }[]>("list_favorites", { accountId });
      setFavoriteUuids(new Set(list.map((f) => f.uuid)));
    } catch {
      /* ignore */
    }
  }

  function persist(next: Placed[]) {
    void invoke("set_app_meta", {
      key: LAYOUT_META_KEY,
      value: JSON.stringify(next),
    }).catch(() => {
      /* best-effort */
    });
  }

  function applyLayout(next: Placed[]) {
    setPlaced(next);
    persist(next);
  }

  // Réinitialise les POSITIONS (placement libre conservé) : réaligne les widgets
  // placés sur leurs positions par défaut, sans changer lesquels sont affichés.
  function resetLayout() {
    applyLayout(placed.map((p, i) => ({ key: p.key, ...defaultPos(i) })));
  }

  function addWidget(key: string) {
    if (placed.some((p) => p.key === key)) return;
    applyLayout([...placed, { key, ...defaultPos(placed.length) }]);
  }

  function removeWidget(key: string) {
    applyLayout(placed.filter((p) => p.key !== key));
  }

  function toggleEdit() {
    setEditing((prev) => {
      const next = !prev;
      setDrawerOpen(next);
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event;
    if (!delta || (delta.x === 0 && delta.y === 0)) return;
    const key = String(active.id);
    applyLayout(
      placed.map((p) =>
        p.key === key
          ? { ...p, x: Math.max(0, p.x + delta.x), y: Math.max(0, p.y + delta.y) }
          : p,
      ),
    );
  }

  return (
    <div className="relative flex h-full flex-col p-4">
      {/* Contrôles flottants en haut à droite : rafraîchir · réinitialiser (édition) · personnaliser. */}
      <div className="absolute right-5 top-5 z-[60] flex items-center gap-2">
        <button
          onClick={() => {
            setRefreshing(true);
            setReloadTick((n) => n + 1);
          }}
          disabled={refreshing}
          title={t("dashboard.refresh")}
          aria-label={t("dashboard.refresh")}
          className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white shadow-lg backdrop-blur transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        {editing && (
          <button
            onClick={resetLayout}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white shadow-lg backdrop-blur transition-colors hover:bg-white/10"
          >
            <RotateCcw className="h-4 w-4" />
            {t("dashboard.resetLayout")}
          </button>
        )}
        <button
          onClick={toggleEdit}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-lg transition-colors ${
            editing
              ? "border-transparent bg-[var(--accent)] text-black"
              : "border-white/10 bg-white/5 text-white backdrop-blur hover:bg-white/10"
          }`}
        >
          {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editing ? t("dashboard.done") : t("dashboard.customize")}
        </button>
      </div>

      {/* Corps : état vide OU canevas libre de widgets */}
      {loaded && placed.length === 0 ? (
        <EmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <div className="relative flex-1 overflow-hidden">
            {/* Logo en filigrane, toujours visible derrière les widgets. */}
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
              <img
                src={logo}
                alt=""
                aria-hidden
                className="w-72 select-none opacity-[0.65]"
                draggable={false}
              />
            </div>
            {placed.map((p) => (
              <FreeWidget
                key={p.key}
                item={p}
                def={WIDGETS[p.key]}
                editing={editing}
                data={data}
                navigate={navigate}
                t={t}
                onOpenMission={setModalMission}
                onRemove={() => removeWidget(p.key)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {/* Bibliothèque de widgets (modale déplaçable) */}
      <WidgetLibraryModal
        open={drawerOpen}
        placed={placed}
        t={t}
        onAdd={addWidget}
        onRemove={removeWidget}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Modale de mission ouverte directement dans le dashboard */}
      {modalMission && (
        <MissionModal
          mission={modalMission}
          scopes={scopes}
          accountId={accountId}
          isObjective={objectiveUuids.has(modalMission.uuid)}
          isFavorite={favoriteUuids.has(modalMission.uuid)}
          onToggleObjective={() => void toggleObjective(modalMission.uuid)}
          onToggleFavorite={() => void toggleFavorite(modalMission.uuid)}
          onClose={() => setModalMission(null)}
        />
      )}

    </div>
  );
}
