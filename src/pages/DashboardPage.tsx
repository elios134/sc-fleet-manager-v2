import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Wallet,
  Rocket,
  AlarmClock,
  Map as MapIcon,
  Shield,
  ClipboardList,
  Ship,
  Link2,
  Bell,
  Pencil,
  Check,
  X,
  type LucideIcon,
} from "lucide-react";
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

/* ──────────────────────────────────────────────────────────────────────────
 * LOT 2 — branchement des données prêtes. 7 widgets affichent les vraies
 * valeurs (valeur de flotte, vaisseaux/LTI, prochaine expiration, modules,
 * assurances, vaisseaux récents, patch). Les 3 widgets lourds/heuristiques
 * (carte galactique, missions reco, suggestion CCU) restent en coquille
 * (« à brancher ») → Lots 3-4.
 *
 * La charpente Lot 1 est conservée : placement libre x/y, drag&drop contraint
 * au canevas, tiroir bibliothèque, persistance AppMeta « dashboard.layout ».
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

type RecentShip = {
  id: number;
  name: string;
  manufacturer: string | null;
  imageUrl: string | null;
  shipDataRole: string | null;
  shipDataClassification: string | null;
};

type DashCore = {
  shipsCount: number;
  totalValueUsd: number;
  ltiCount: number;
  lastSyncedAt: string | null;
  recentShips: RecentShip[];
};

type NextExpiry = { shipName: string; daysRemaining: number };
type FleetStats = { nextExpiry: NextExpiry | null };
type PatchStatus = { status: string; installedVersion: string | null };

type CcuShip = {
  shipId: number;
  name: string;
  priceCents: number | null;
  priceSource: "ccu" | "msrp" | null;
  isOwned: boolean;
};

type DashData = {
  core: DashCore | null;
  stats: FleetStats | null;
  insurance: InsuranceShip[];
  patch: PatchStatus | null;
  missions: MissionListItem[];
  ccuShips: CcuShip[];
};

const WIDGETS: Record<string, WidgetDef> = {
  value: {
    key: "value",
    titleKey: "dashboard.wValueTitle",
    nameKey: "dashboard.wValueName",
    descKey: "dashboard.wValueDesc",
    span: 1,
    Icon: Wallet,
    tint: "rgba(245,166,35,.12)",
    accent: "#f5a623",
  },
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
  nextexp: {
    key: "nextexp",
    titleKey: "dashboard.wNextExpTitle",
    nameKey: "dashboard.wNextExpName",
    descKey: "dashboard.wNextExpDesc",
    span: 1,
    Icon: AlarmClock,
    tint: "rgba(213,83,126,.12)",
    accent: "#d4537e",
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
  recent: {
    key: "recent",
    titleKey: "dashboard.wRecentTitle",
    nameKey: "dashboard.wRecentName",
    descKey: "dashboard.wRecentDesc",
    span: 2,
    Icon: Ship,
    tint: "rgba(55,138,221,.12)",
    accent: "#378add",
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
  patch: {
    key: "patch",
    titleKey: "dashboard.wPatchTitle",
    nameKey: "dashboard.wPatchName",
    descKey: "dashboard.wPatchDesc",
    span: 1,
    Icon: Bell,
    tint: "rgba(245,166,35,.12)",
    accent: "#f5a623",
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

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

  const [data, setData] = useState<DashData | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // État pour la modale de mission ouverte DANS le dashboard.
  const [accountId, setAccountId] = useState("");
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [objectiveUuids, setObjectiveUuids] = useState<Set<string>>(new Set());
  const [favoriteUuids, setFavoriteUuids] = useState<Set<string>>(new Set());
  const [modalMission, setModalMission] = useState<MissionListItem | null>(null);

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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Indépendants du compte : catalogue missions + scopes (réputation).
      const [missions, scopesData] = await Promise.all([
        invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }).catch(
          () => [] as MissionListItem[],
        ),
        invoke<ScopeWithRanks[]>("get_scopes").catch(() => [] as ScopeWithRanks[]),
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
            stats: null,
            insurance: [],
            patch: null,
            missions,
            ccuShips: [],
          });
          setObjectiveUuids(new Set());
          setFavoriteUuids(new Set());
        }
        return;
      }

      const [core, stats, insurance, patch, ccuShips, objectives, favorites] =
        await Promise.all([
          invoke<DashCore>("get_dashboard_data", { accountId: acc }).catch(() => null),
          invoke<FleetStats>("get_fleet_stats", { accountId: acc }).catch(() => null),
          invoke<InsuranceShip[]>("get_insurance_ships", { accountId: acc }).catch(
            () => [] as InsuranceShip[],
          ),
          invoke<PatchStatus>("get_patch_status").catch(() => null),
          invoke<CcuShip[]>("get_ccu_ships_metadata", { accountId: acc }).catch(
            () => [] as CcuShip[],
          ),
          invoke<{ uuid: string }[]>("list_objectives", { accountId: acc }).catch(
            () => [] as { uuid: string }[],
          ),
          invoke<{ uuid: string }[]>("list_favorites", { accountId: acc }).catch(
            () => [] as { uuid: string }[],
          ),
        ]);
      if (!cancelled) {
        setData({ core, stats, insurance, patch, missions, ccuShips });
        setObjectiveUuids(new Set(objectives.map((o) => o.uuid)));
        setFavoriteUuids(new Set(favorites.map((f) => f.uuid)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

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

  const canvasHeight =
    placed.length === 0
      ? 440
      : Math.max(440, ...placed.map((p) => p.y + ROW_H)) + 40;

  return (
    <div className="p-8 pb-32">
      {/* Topbar : bouton Personnaliser (HAUT À DROITE) */}
      <header className="mb-6 flex items-start justify-end">
        <button
          onClick={toggleEdit}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            editing
              ? "border-transparent bg-[var(--accent)] text-black"
              : "border-white/10 bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editing ? t("dashboard.done") : t("dashboard.customize")}
        </button>
      </header>

      {/* Corps : état vide OU canevas libre de widgets */}
      {loaded && placed.length === 0 ? (
        <EmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <div className="relative" style={{ height: canvasHeight }}>
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

      {/* Tiroir bibliothèque de widgets */}
      <WidgetDrawer
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
    <div className="flex min-h-[440px] flex-col items-center justify-center">
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
    case "value":
      if (!data.core) break;
      return (
        <>
          {title}
          <div className="text-2xl font-bold" style={{ color: def.accent }}>
            {formatUsd(data.core.totalValueUsd)}
          </div>
        </>
      );

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

    case "nextexp": {
      if (!data.stats) break;
      const ne = data.stats.nextExpiry;
      if (!ne) {
        return (
          <>
            {title}
            <div className="text-2xl font-bold text-white/40">—</div>
            <div className="mt-1 text-xs text-white/50">{t("dashboard.wNextExpNone")}</div>
          </>
        );
      }
      const expired = ne.daysRemaining < 0;
      return (
        <>
          {title}
          <div className="text-2xl font-bold" style={{ color: def.accent }}>
            {expired ? t("dashboard.wNextExpired") : t("dashboard.dMinus", { days: ne.daysRemaining })}
          </div>
          <div className="mt-1 truncate text-xs text-white/50">{ne.shipName}</div>
        </>
      );
    }

    case "insurance":
      return (
        <>
          {title}
          <InsuranceBody ships={data.insurance} t={t} />
        </>
      );

    case "recent":
      if (!data.core) break;
      return (
        <>
          {title}
          <RecentBody ships={data.core.recentShips} navigate={navigate} t={t} />
        </>
      );

    case "patch":
      if (!data.patch) break;
      return (
        <>
          {title}
          <PatchBody patch={data.patch} t={t} />
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

/* ── Vaisseaux récents ── */

function RecentBody({
  ships,
  navigate,
  t,
}: {
  ships: RecentShip[];
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction;
}) {
  if (ships.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.noShipsRegistered")}
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto">
      {ships.slice(0, 4).map((ship) => (
        <MiniShipCard key={ship.id} ship={ship} onClick={() => navigate("/fleet")} t={t} />
      ))}
    </div>
  );
}

function MiniShipCard({
  ship,
  onClick,
  t,
}: {
  ship: RecentShip;
  onClick: () => void;
  t: TFunction;
}) {
  const role = ship.shipDataRole ?? ship.shipDataClassification ?? "—";
  return (
    <button
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="group flex w-[120px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left transition-colors hover:bg-white/10"
    >
      {ship.imageUrl ? (
        <img
          src={ship.imageUrl}
          alt={ship.name}
          className="h-16 w-full bg-black/30 object-contain p-1"
        />
      ) : (
        <div className="flex h-16 w-full items-center justify-center bg-white/5 text-[10px] text-white/30">
          {t("common.noImage")}
        </div>
      )}
      <div className="p-2">
        <p className="truncate text-[11px] font-medium text-white">{ship.name}</p>
        <p className="truncate text-[10px] text-white/40">{role}</p>
      </div>
    </button>
  );
}

/* ── Patch & événements ── */

function PatchBody({ patch, t }: { patch: PatchStatus; t: TFunction }) {
  let accent = "#9c99b0";
  let bg = "rgba(255,255,255,.04)";
  let titleTxt = t("dashboard.wPatchUnknown");
  let subTxt = t("dashboard.wPatchUnknownSub");

  if (patch.status === "patch_detected") {
    accent = "#f5a623";
    bg = "rgba(245,166,35,.08)";
    titleTxt = t("dashboard.wPatchDetected");
    subTxt = t("dashboard.wPatchResync");
  } else if (patch.status === "up_to_date") {
    accent = "#2ee9a5";
    bg = "rgba(46,233,165,.08)";
    titleTxt = t("dashboard.wPatchUpToDate");
    subTxt = t("dashboard.wPatchUpToDateSub");
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg px-3 py-3"
      style={{ background: bg, border: `0.5px solid ${accent}33` }}
    >
      <Bell className="h-4 w-4 shrink-0" style={{ color: accent }} />
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold" style={{ color: accent }}>
          {titleTxt}
        </div>
        <div className="truncate text-[11px] text-white/50">{subTxt}</div>
      </div>
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

/* ─────────────────────────── Tiroir bibliothèque ──────────────────────────── */

function WidgetDrawer({
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
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 max-h-[60vh] overflow-y-auto border-t border-white/10 bg-[#120e24]/95 px-8 pb-24 pt-5 backdrop-blur transition-transform duration-200 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">{t("dashboard.widgetLibrary")}</h3>
        <button
          onClick={onClose}
          className="text-2xl leading-none text-white/50 hover:text-white"
          aria-label={t("dashboard.close")}
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {WIDGET_ORDER.map((key) => {
          const def = WIDGETS[key];
          const added = placed.some((p) => p.key === key);
          return (
            <button
              key={key}
              onClick={() => onAdd(key)}
              disabled={added}
              className={`rounded-xl border p-4 text-left transition-colors ${
                added
                  ? "border-[#2ee9a5]/30 bg-white/5"
                  : "border-white/10 bg-white/5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5"
              }`}
            >
              <div
                className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ background: def.tint, color: def.accent }}
              >
                <def.Icon className="h-4 w-4" />
              </div>
              <div className="text-sm font-semibold text-white">{t(def.nameKey)}</div>
              <div className="mt-1 text-xs text-white/50">{t(def.descKey)}</div>
              {added && (
                <div className="mt-2 text-[10px] font-medium text-[#2ee9a5]">
                  {t("dashboard.added")}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
