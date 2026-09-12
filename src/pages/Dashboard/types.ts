import { type LucideIcon } from "lucide-react";
import { type InsuranceShip } from "../../lib/insurance";
import { type MissionListItem } from "../missionShared";

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

/* ── Suggestion CCU : possédé le plus cher → prochain palier de valeur ── */

type CcuSuggestion = { from: CcuShip; to: CcuShip; delta: number };
export type { WidgetDef, Placed, DashCore, CcuShip, ShipRow, RentedShip, TopRoute, TopRoutesResult, RsiComponent, RsiServerStatus, NewsItem, DashData, CcuSuggestion };
