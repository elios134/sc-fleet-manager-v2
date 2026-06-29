import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Rocket,
  Map as MapIcon,
  Shield,
  ClipboardList,
  Link2,
  AlarmClock,
  Truck,
  ArrowRight,
  Pencil,
  Check,
  X,
  Newspaper,
  Activity,
  RefreshCw,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";

import logo from "../assets/logo.png";
import {
  buildInsuranceRow,
  sortByUrgency,
  type InsuranceShip,
  type UiStatus,
} from "../lib/insurance";
import {
  MissionModal,
  type MissionListItem,
  type ScopeWithRanks,
} from "./MissionIntelPage";
import StarmapMini from "../components/StarmapMini";
import { rentalDaysLeft } from "../components/ShipCard";
import { useDatamining } from "../contexts/DataminingContext";

/* ──────────────────────────────────────────────────────────────────────────
 * Dashboard : widgets branchés sur les données réelles (vaisseaux/LTI, carte
 * galactique, assurances, missions reco, suggestion CCU). Placement libre x/y,
 * drag&drop contraint au canevas, tiroir « bibliothèque » pour ajouter/retirer,
 * persistance de la disposition en AppMeta « dashboard.layout ». Les clés
 * inconnues d'une disposition sauvegardée sont ignorées au chargement.
 * ────────────────────────────────────────────────────────────────────────── */

const LAYOUT_META_KEY = "dashboard.layout";

// Largeurs en pixels selon le span (placement libre = pas de grille).
const COL_W = 260;
const GAP = 16;
const WIDTH_1 = COL_W;
const WIDTH_2 = COL_W * 2 + GAP;
const ROW_H = 200;

// Widgets non encore branchés (restent en coquille). Tous branchés (Lots 2-4).
const PENDING_WIDGETS = new Set<string>([]);

type WidgetDef = {
  key: string;
  titleKey: string; // titre eyebrow sur la carte
  nameKey: string; // nom dans la bibliothèque
  descKey: string; // description dans la bibliothèque
  span: 1 | 2;
  Icon: LucideIcon;
  tint: string;
  accent: string;
};

type Placed = { key: string; x: number; y: number };

/* ── Données ── */

type DashCore = {
  shipsCount: number;
  ltiCount: number;
  lastSyncedAt: string | null;
};

type CcuShip = {
  shipId: number;
  name: string;
  priceCents: number | null;
  priceSource: "ccu" | "msrp" | null;
  isOwned: boolean;
};

// Sous-ensemble de get_ships utile au widget « Locations » (champs location).
type ShipRow = {
  id: number;
  name: string;
  acquisition: string;
  rentalExpiresAt: string | null;
  rentalDurationDays: number | null;
};
type RentedShip = { id: number; name: string; rentalExpiresAt: string | null };

// Sous-ensemble de FindRoutesResult (get_dashboard_top_routes) utile au widget « Routes ».
type TopRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  profit: number;
  profitPerMinute: number | null;
};
type TopRoutesResult = { shipName: string; routes: TopRoute[] };

// Statut serveurs RSI (get_rsi_server_status).
type RsiComponent = { name: string; status: string };
type RsiServerStatus = {
  overall: string;
  overallLabel: string;
  components: RsiComponent[];
};

// Actualité RSI (get_rsi_news).
type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  category: string | null;
  summary: string | null;
};

type DashData = {
  core: DashCore | null;
  insurance: InsuranceShip[];
  missions: MissionListItem[];
  ccuShips: CcuShip[];
  rentedShips: RentedShip[];
  topRoutes: TopRoutesResult | null;
  rsiStatus: RsiServerStatus | null;
  news: NewsItem[];
};

const WIDGETS: Record<string, WidgetDef> = {
  ships: {
    key: "ships",
    titleKey: "dashboard.wShipsTitle",
    nameKey: "dashboard.wShipsName",
    descKey: "dashboard.wShipsDesc",
    span: 1,
    Icon: Rocket,
    tint: "rgba(55,138,221,.12)",
    accent: "#378add",
  },
  starmap: {
    key: "starmap",
    titleKey: "dashboard.wStarmapTitle",
    nameKey: "dashboard.wStarmapName",
    descKey: "dashboard.wStarmapDesc",
    span: 2,
    Icon: MapIcon,
    tint: "rgba(93,202,165,.12)",
    accent: "#5dcaa5",
  },
  insurance: {
    key: "insurance",
    titleKey: "dashboard.wInsuranceTitle",
    nameKey: "dashboard.wInsuranceName",
    descKey: "dashboard.wInsuranceDesc",
    span: 2,
    Icon: Shield,
    tint: "rgba(213,83,126,.12)",
    accent: "#d4537e",
  },
  missions: {
    key: "missions",
    titleKey: "dashboard.wMissionsTitle",
    nameKey: "dashboard.wMissionsName",
    descKey: "dashboard.wMissionsDesc",
    span: 2,
    Icon: ClipboardList,
    tint: "rgba(93,202,165,.12)",
    accent: "#5dcaa5",
  },
  ccu: {
    key: "ccu",
    titleKey: "dashboard.wCcuTitle",
    nameKey: "dashboard.wCcuName",
    descKey: "dashboard.wCcuDesc",
    span: 1,
    Icon: Link2,
    tint: "rgba(127,119,221,.12)",
    accent: "#7f77dd",
  },
  locations: {
    key: "locations",
    titleKey: "dashboard.wLocationsTitle",
    nameKey: "dashboard.wLocationsName",
    descKey: "dashboard.wLocationsDesc",
    span: 1,
    Icon: AlarmClock,
    tint: "rgba(213,83,126,.12)",
    accent: "#d4537e",
  },
  routes: {
    key: "routes",
    titleKey: "dashboard.wRoutesTitle",
    nameKey: "dashboard.wRoutesName",
    descKey: "dashboard.wRoutesDesc",
    span: 2,
    Icon: Truck,
    tint: "rgba(93,202,165,.12)",
    accent: "#5dcaa5",
  },
  rsiStatus: {
    key: "rsiStatus",
    titleKey: "dashboard.wRsiStatusTitle",
    nameKey: "dashboard.wRsiStatusName",
    descKey: "dashboard.wRsiStatusDesc",
    span: 1,
    Icon: Activity,
    tint: "rgba(46,233,165,.12)",
    accent: "#2ee9a5",
  },
  news: {
    key: "news",
    titleKey: "dashboard.wNewsTitle",
    nameKey: "dashboard.wNewsName",
    descKey: "dashboard.wNewsDesc",
    span: 2,
    Icon: Newspaper,
    tint: "rgba(55,138,221,.12)",
    accent: "#378add",
  },
};

const WIDGET_ORDER = Object.keys(WIDGETS);

function widthOf(def: WidgetDef): number {
  return def.span === 2 ? WIDTH_2 : WIDTH_1;
}

function defaultPos(index: number): { x: number; y: number } {
  const perRow = 4;
  return {
    x: (index % perRow) * (COL_W + GAP),
    y: Math.floor(index / perRow) * ROW_H,
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatAuec(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Canevas des widgets : sert à reclamper les positions (placement libre absolu) dans
  // la largeur dispo quand la fenêtre rétrécit, sinon les widgets à x élevé sortaient
  // du conteneur overflow-hidden et disparaissaient. On NE persiste PAS (positions
  // sauvegardées préservées) ; on borne seulement l'affichage.
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      setPlaced((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const def = WIDGETS[p.key];
          if (!def) return p;
          const maxX = Math.max(0, w - widthOf(def));
          const nx = Math.min(Math.max(0, p.x), maxX);
          const ny = Math.max(0, p.y);
          if (nx !== p.x || ny !== p.y) {
            changed = true;
            return { ...p, x: nx, y: ny };
          }
          return p;
        });
        return changed ? next : prev;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [data, setData] = useState<DashData | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

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
          ? invoke<NewsItem[]>("get_rsi_news", { limit: 6 }).catch(() => [] as NewsItem[])
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
        }
        return;
      }

      const [core, insurance, ccuShips, allShips, topRoutes, objectives, favorites] =
        await Promise.all([
          invoke<DashCore>("get_dashboard_data", { accountId: acc }).catch(() => null),
          keys.has("insurance")
            ? invoke<InsuranceShip[]>("get_insurance_ships", { accountId: acc }).catch(
                () => [] as InsuranceShip[],
              )
            : Promise.resolve([] as InsuranceShip[]),
          keys.has("ccu")
            ? invoke<CcuShip[]>("get_ccu_ships_metadata", { accountId: acc }).catch(
                () => [] as CcuShip[],
              )
            : Promise.resolve([] as CcuShip[]),
          keys.has("locations")
            ? invoke<ShipRow[]>("get_ships", { accountId: acc }).catch(() => [] as ShipRow[])
            : Promise.resolve([] as ShipRow[]),
          keys.has("routes")
            ? invoke<TopRoutesResult | null>("get_dashboard_top_routes", { limit: 3 }).catch(
                () => null,
              )
            : Promise.resolve(null),
          invoke<{ uuid: string }[]>("list_objectives", { accountId: acc }).catch(
            () => [] as { uuid: string }[],
          ),
          invoke<{ uuid: string }[]>("list_favorites", { accountId: acc }).catch(
            () => [] as { uuid: string }[],
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
          onClick={() => setReloadTick((n) => n + 1)}
          title={t("dashboard.refresh")}
          aria-label={t("dashboard.refresh")}
          className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white shadow-lg backdrop-blur transition-colors hover:bg-white/10"
        >
          <RefreshCw className="h-4 w-4" />
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
          <div ref={canvasRef} className="relative flex-1 overflow-hidden">
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

/* ─────────────────────────── État vide (logo en gros) ─────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <img
        src={logo}
        alt="SC Fleet Manager"
        className="w-44 select-none opacity-90"
        draggable={false}
      />
    </div>
  );
}

/* ─────────────────── Widget librement déplaçable ────────────────── */

function FreeWidget({
  item,
  def,
  editing,
  data,
  navigate,
  t,
  onOpenMission,
  onRemove,
}: {
  item: Placed;
  def: WidgetDef;
  editing: boolean;
  data: DashData | null;
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction;
  onOpenMission: (m: MissionListItem) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: def.key,
    disabled: !editing,
  });

  const style: React.CSSProperties = {
    position: "absolute",
    left: item.x,
    top: item.y,
    width: widthOf(def),
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editing ? { ...attributes, ...listeners } : {})}
      className={`rounded-2xl border bg-white/5 p-4 ${
        editing
          ? "cursor-grab border-dashed border-[var(--accent)]/40 active:cursor-grabbing"
          : "border-white/10"
      } ${isDragging ? "opacity-80 shadow-2xl" : ""}`}
    >
      {editing && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-[#d4537e] text-white shadow hover:brightness-110"
          aria-label={t("dashboard.removeWidget")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      <WidgetBody
        def={def}
        data={data}
        navigate={navigate}
        t={t}
        editing={editing}
        onOpenMission={onOpenMission}
      />
    </div>
  );
}

/* ─────────────────────────── Contenu des widgets ──────────────────────────── */

function WidgetBody({
  def,
  data,
  navigate,
  t,
  editing,
  onOpenMission,
}: {
  def: WidgetDef;
  data: DashData | null;
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction;
  editing: boolean;
  onOpenMission: (m: MissionListItem) => void;
}) {
  // Titre eyebrow, avec lien d'accent optionnel à droite (missions / ccu).
  const renderTitle = (linkLabel?: string) => (
    <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-white/50">
      <span>{t(def.titleKey)}</span>
      {linkLabel && (
        <span className="normal-case tracking-normal text-[var(--accent)]">{linkLabel}</span>
      )}
    </div>
  );
  const title = renderTitle();

  // Widgets restant en coquille (Lot 4 : carte galactique).
  if (PENDING_WIDGETS.has(def.key)) {
    return (
      <>
        {title}
        <PendingBox def={def} t={t} />
      </>
    );
  }

  // Tant que les données ne sont pas chargées : neutre.
  if (!data) {
    return (
      <>
        {title}
        <NeutralBox def={def} span={def.span} />
      </>
    );
  }

  switch (def.key) {
    case "ships":
      if (!data.core) break;
      return (
        <>
          {title}
          <div className="text-2xl font-bold text-white">{data.core.shipsCount}</div>
          <div className="mt-1 text-xs text-white/50">
            {t("dashboard.wShipsLti", { count: data.core.ltiCount })}
          </div>
        </>
      );

    case "insurance":
      return (
        <>
          {title}
          <InsuranceBody ships={data.insurance} t={t} />
        </>
      );

    case "starmap":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/starmap")}>
          {renderTitle(t("dashboard.wStarmapLink"))}
          <StarmapMini t={t} />
        </ClickableBody>
      );

    case "missions": {
      const top = data.missions
        .filter((m) => m.rewardMax != null)
        .sort((a, b) => (b.rewardMax ?? 0) - (a.rewardMax ?? 0))
        .slice(0, 3);
      return (
        <>
          {renderTitle(t("dashboard.wMissionsLink"))}
          <MissionsBody missions={top} t={t} editing={editing} onOpen={onOpenMission} />
        </>
      );
    }

    case "ccu": {
      const sug = computeCcuSuggestion(data.ccuShips);
      if (!sug) {
        return (
          <>
            {renderTitle(t("dashboard.wCcuLink"))}
            <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
              {t("dashboard.wCcuNone")}
            </div>
          </>
        );
      }
      return (
        <ClickableBody
          editing={editing}
          onClick={() =>
            navigate("/ccu-chain", {
              state: { fromShipId: sug.from.shipId, toShipId: sug.to.shipId },
            })
          }
        >
          {renderTitle(t("dashboard.wCcuLink"))}
          <CcuBody from={sug.from} to={sug.to} delta={sug.delta} accent={def.accent} />
        </ClickableBody>
      );
    }

    case "locations":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/fleet")}>
          {renderTitle(t("dashboard.wLocationsLink"))}
          <LocationsBody ships={data.rentedShips} t={t} />
        </ClickableBody>
      );

    case "routes":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/cargo-routes")}>
          {renderTitle(t("dashboard.wRoutesLink"))}
          <RoutesBody result={data.topRoutes} t={t} editing={editing} navigate={navigate} />
        </ClickableBody>
      );

    case "rsiStatus":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/news")}>
          {title}
          <RsiStatusBody status={data.rsiStatus} t={t} />
        </ClickableBody>
      );

    case "news":
      return (
        <>
          {title}
          <NewsBody items={data.news} t={t} editing={editing} />
          {!editing && (
            <button
              onClick={() => navigate("/news")}
              className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] transition-opacity hover:opacity-80"
            >
              {t("dashboard.seeAll")}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </>
      );
  }

  // Repli neutre (données de la tranche absentes).
  return (
    <>
      {title}
      <NeutralBox def={def} span={def.span} />
    </>
  );
}

/* Wrapper cliquable : navigue au clic hors mode édition (en édition, priorité au drag). */
function ClickableBody({
  editing,
  onClick,
  children,
}: {
  editing: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div onClick={editing ? undefined : onClick} className={editing ? undefined : "cursor-pointer"}>
      {children}
    </div>
  );
}

/* ── Boîtes génériques ── */

function PendingBox({ def, t }: { def: WidgetDef; t: TFunction }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-white/30 ${
        def.span === 2 ? "min-h-[120px]" : "min-h-[72px]"
      }`}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: def.tint, color: def.accent }}
      >
        <def.Icon className="h-4 w-4" />
      </div>
      <span className="text-xs">{t("dashboard.pending")}</span>
    </div>
  );
}

function NeutralBox({ def, span }: { def: WidgetDef; span: 1 | 2 }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-dashed border-white/10 text-2xl font-bold text-white/30 ${
        span === 2 ? "min-h-[120px]" : "min-h-[72px]"
      }`}
    >
      <span className="sr-only">{def.key}</span>—
    </div>
  );
}

/* ── Assurances : 3 lignes les plus urgentes ── */

const INS_COLOR: Record<UiStatus, string> = {
  ACTIVE: "#34d399",
  WARNING: "#fbbf24",
  EXPIRED: "#f87171",
};

function InsuranceBody({ ships, t }: { ships: InsuranceShip[]; t: TFunction }) {
  const rows = sortByUrgency(ships.map(buildInsuranceRow)).slice(0, 3);
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wInsuranceNone")}
      </div>
    );
  }
  return (
    <div>
      {rows.map((r) => {
        const color = r.lti ? INS_COLOR.ACTIVE : INS_COLOR[r.status];
        const label = r.lti
          ? t("dashboard.wInsuranceLti")
          : r.daysLeft != null && r.daysLeft < 0
            ? t("dashboard.wNextExpired")
            : r.daysLeft != null
              ? t("dashboard.dMinus", { days: r.daysLeft })
              : r.expiryLabel;
        return (
          <div
            key={r.shipId}
            className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0">
                <div className="truncate text-[13px] text-white">{r.name}</div>
                <div className="truncate text-[10px] text-white/40">{r.manufacturer}</div>
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold" style={{ color }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Missions recommandées : top 3 par récompense brute ── */

function MissionsBody({
  missions,
  t,
  editing,
  onOpen,
}: {
  missions: MissionListItem[];
  t: TFunction;
  editing: boolean;
  onOpen: (m: MissionListItem) => void;
}) {
  if (missions.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wMissionsNone")}
      </div>
    );
  }
  return (
    <div>
      {missions.map((m) => (
        <div
          key={m.uuid}
          // Clic ligne → ouvre la modale de la mission DANS le dashboard (hors édition).
          onClick={editing ? undefined : () => onOpen(m)}
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="truncate text-[13px] font-medium text-white">{m.title}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/40">
              {m.factionName ?? "—"}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-[#5dcaa5]">
              {t("dashboard.aUec", { amount: formatAuec(m.rewardMax ?? 0) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Suggestion CCU : possédé le plus cher → prochain palier de valeur ── */

type CcuSuggestion = { from: CcuShip; to: CcuShip; delta: number };

function computeCcuSuggestion(ships: CcuShip[]): CcuSuggestion | null {
  // « Depuis » = vaisseau possédé au priceCents le plus élevé.
  const owned = ships.filter((s) => s.isOwned && s.priceCents != null);
  if (owned.length === 0) return null;
  const from = owned.reduce((a, b) => ((b.priceCents ?? 0) > (a.priceCents ?? 0) ? b : a));

  // « Cible » = vaisseau CCU-able au priceCents immédiatement supérieur.
  const fromPrice = from.priceCents ?? 0;
  const targets = ships.filter(
    (s) => s.priceSource === "ccu" && s.priceCents != null && s.priceCents > fromPrice,
  );
  if (targets.length === 0) return null;
  const to = targets.reduce((a, b) =>
    (b.priceCents ?? Infinity) < (a.priceCents ?? Infinity) ? b : a,
  );

  return { from, to, delta: (to.priceCents ?? 0) - fromPrice };
}

function CcuBody({
  from,
  to,
  delta,
  accent,
}: {
  from: CcuShip;
  to: CcuShip;
  delta: number;
  accent: string;
}) {
  return (
    <div>
      <div className="truncate text-xs text-white/50">{from.name}</div>
      <div className="truncate text-sm font-semibold text-white">→ {to.name}</div>
      <div className="mt-2 text-sm font-bold" style={{ color: accent }}>
        +{formatCents(delta)}
      </div>
    </div>
  );
}

/* ── Locations qui expirent : top 3 loués par échéance (compte actif) ── */

function LocationsBody({ ships, t }: { ships: RentedShip[]; t: TFunction }) {
  const rows = ships.slice(0, 3);
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wLocationsNone")}
      </div>
    );
  }
  return (
    <div>
      {rows.map((s) => {
        const d = rentalDaysLeft(s.rentalExpiresAt);
        const expired = d != null && d <= 0;
        // Couleur badge (comme ShipCard) : expiré rouge, ≤3 j ambre, sinon vert.
        const color = expired ? "#f87171" : d != null && d <= 3 ? "#fbbf24" : "#34d399";
        const label =
          d == null
            ? "—"
            : expired
              ? t("dashboard.wLocationsExpired")
              : t("dashboard.wLocationsIn", { days: d });
        return (
          <div
            key={s.id}
            className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
          >
            <span className="min-w-0 truncate text-[13px] text-white">{s.name}</span>
            <span className="shrink-0 text-xs font-semibold" style={{ color }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Top routes rentables : top 3 par profit/min (plus gros cargo du compte actif) ── */

function RoutesBody({
  result,
  t,
  editing,
  navigate,
}: {
  result: TopRoutesResult | null;
  t: TFunction;
  editing: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const routes = result?.routes ?? [];
  if (routes.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center px-3 text-center text-xs text-white/40">
        {t("dashboard.wRoutesNone")}
      </div>
    );
  }
  const shipName = result?.shipName ?? "";
  return (
    <div>
      {routes.slice(0, 3).map((r, i) => (
        <div
          key={i}
          // Clic sur une route → ouvre le planificateur DIRECTEMENT sur cette route
          // (vaisseau + identité de la route en state). stopPropagation : n'enchaîne pas
          // sur le clic « général » de la carte. Hors édition (priorité au drag).
          onClick={
            editing
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  navigate("/cargo-routes", {
                    state: {
                      route: {
                        shipName,
                        commodity: r.commodity,
                        fromLocation: r.fromLocation,
                        toLocation: r.toLocation,
                      },
                    },
                  });
                }
          }
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-white">
              {r.commodity}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-[#5dcaa5]">
              {r.profitPerMinute != null
                ? t("dashboard.wRoutesPerMin", { amount: formatAuec(r.profitPerMinute) })
                : t("dashboard.aUec", { amount: formatAuec(r.profit) })}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-white/40">
              <span className="truncate">{r.fromLocation}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.toLocation}</span>
            </span>
            <span className="shrink-0 text-[10px] text-white/30">
              {t("dashboard.wRoutesTotal", { amount: formatAuec(r.profit) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Statut serveurs RSI : pastille globale + composants (Phase 0) ── */

// Couleur par code de statut interne (cf. rsi_status.rs).
const RSI_STATUS_COLOR: Record<string, string> = {
  operational: "#34d399",
  degraded: "#fbbf24",
  partial: "#fb923c",
  major: "#f87171",
  maintenance: "#60a5fa",
  unknown: "#9ca3af",
};

function rsiStatusColor(code: string): string {
  return RSI_STATUS_COLOR[code] ?? RSI_STATUS_COLOR.unknown;
}

function RsiStatusBody({
  status,
  t,
}: {
  status: RsiServerStatus | null;
  t: TFunction;
}) {
  if (!status) {
    return (
      <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wRsiStatusUnavailable")}
      </div>
    );
  }
  const color = rsiStatusColor(status.overall);
  // Libellé global : on privilégie une traduction si le code est connu, sinon le brut.
  const overallLabel =
    status.overall !== "unknown"
      ? t(`dashboard.wRsiStatusOverall.${status.overall}`)
      : status.overallLabel || t("dashboard.wRsiStatusUnavailable");
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
        <span className="truncate text-[13px] font-semibold text-white">{overallLabel}</span>
      </div>
      <div className="space-y-1">
        {status.components.slice(0, 4).map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/55">{c.name}</span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: rsiStatusColor(c.status) }}
              title={c.status}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Actualités RSI : liste cliquable ouvrant le comm-link (Phase 0) ── */

function NewsBody({
  items,
  t,
  editing,
}: {
  items: NewsItem[];
  t: TFunction;
  editing: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wNewsNone")}
      </div>
    );
  }
  return (
    <div>
      {items.slice(0, 5).map((n) => (
        <div
          key={n.link}
          onClick={editing ? undefined : () => void openUrl(n.link).catch(() => {})}
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="truncate text-[13px] font-medium text-white">{n.title}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/40">
              {n.category ?? "Comm-Link"}
            </span>
            {n.pubDate && (
              <span className="shrink-0 text-[10px] text-white/30">
                {formatNewsDate(n.pubDate)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Date RSS (RFC-822) → court format local. Repli : chaîne brute si non parsable.
function formatNewsDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/* ─────────────── Bibliothèque de widgets (modale glassmorphique déplaçable) ─── */

function WidgetLibraryModal({
  open,
  placed,
  t,
  onAdd,
  onClose,
}: {
  open: boolean;
  placed: Placed[];
  t: TFunction;
  onAdd: (key: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // null = position centrée par défaut ; sinon coordonnées fixes (après déplacement).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Recentre à chaque réouverture.
  useEffect(() => {
    if (open) setPos(null);
  }, [open]);

  if (!open) return null;

  // Déplacement libre via l'en-tête, borné à la fenêtre (jamais hors écran → pas de scroll).
  function startDrag(e: React.PointerEvent) {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const { left: originX, top: originY, width: w, height: h } = rect;
    setPos({ x: originX, y: originY });
    const move = (ev: PointerEvent) => {
      const nx = Math.min(Math.max(0, originX + ev.clientX - startX), window.innerWidth - w);
      const ny = Math.min(Math.max(0, originY + ev.clientY - startY), window.innerHeight - h);
      setPos({ x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const placement: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: "50%", top: 96, transform: "translateX(-50%)" };

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", zIndex: 50, ...placement }}
      className="w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-white/15 bg-[#14101f]/80 shadow-2xl backdrop-blur-2xl"
    >
      {/* En-tête = poignée de déplacement */}
      <div
        onPointerDown={startDrag}
        className="flex cursor-move touch-none select-none items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-3"
      >
        <h3 className="text-sm font-semibold tracking-wide text-white">
          {t("dashboard.widgetLibrary")}
        </h3>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={t("dashboard.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Grille des widgets disponibles : icône + nom + description, sans scroll */}
      <div className="grid grid-cols-3 gap-2.5 p-4">
        {WIDGET_ORDER.map((key) => {
          const def = WIDGETS[key];
          const added = placed.some((p) => p.key === key);
          return (
            <button
              key={key}
              onClick={() => onAdd(key)}
              disabled={added}
              className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                added
                  ? "cursor-default border-[#2ee9a5]/30 bg-[#2ee9a5]/[0.06]"
                  : "border-white/10 bg-white/5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: def.tint, color: def.accent }}
                >
                  <def.Icon className="h-4 w-4" />
                </div>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                  {t(def.nameKey)}
                </span>
                {added && <Check className="h-3.5 w-3.5 shrink-0 text-[#2ee9a5]" />}
              </div>
              <span className="text-[11px] leading-snug text-white/45">{t(def.descKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
