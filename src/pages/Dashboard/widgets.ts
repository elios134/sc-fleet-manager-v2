import { Rocket, Shield, ClipboardList, Link2, AlarmClock, Truck, Newspaper, Activity, Map as MapIcon } from "lucide-react";
import { type WidgetDef } from "./types";

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

export { LAYOUT_META_KEY, COL_W, GAP, WIDTH_1, WIDTH_2, ROW_H, PENDING_WIDGETS, WIDGETS, WIDGET_ORDER };
