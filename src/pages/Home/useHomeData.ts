// Chargement des données de l'accueil : chaque source est indépendante (un échec n'efface
// pas les autres blocs) et vaut null tant qu'elle n'a rien d'exploitable.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { buildInsuranceRow, type InsuranceRow, type InsuranceShip } from "../../lib/insurance";
import type { InvState, ItemMeta } from "../Inventory/types";
import { topItems } from "./home";

export type HangarStatus = { status: { status: string; secondsRemaining: number } };
export type RsiServerStatus = { overall: string; overallLabel: string; components: { name: string; status: string }[] };
export type NewsItem = { title: string; link: string; pubDate: string | null };
export type TopRoutes = { shipName: string; routes: { commodity: string; fromLocation: string; toLocation: string; profit: number }[] };
export type Journal = {
  lastSession: { date: string | null; durationSeconds: number; location: string | null } | null;
  spendingTotal: number;
  missions: { completed: number };
  blueprintsUnlocked: number;
};
export type Channel = { label: string; install: { packId: string; updateAvailable: boolean } | null };
export type HomeData = {
  handle: string | null;
  gamelog: { enabled: boolean; pathExists: boolean; currentLocation: string | null; logAgeSecs: number | null } | null;
  inventory: InvState | null;
  meta: Record<string, ItemMeta>;
  top: { classe: string; qte: number }[];
  insurance: InsuranceRow[];
  fleet: { shipsCount: number; ltiCount: number } | null;
  channels: Channel[];
  uexAgeHours: number | null;
  hangar: HangarStatus | null;
  servers: RsiServerStatus | null;
  news: NewsItem[];
  routes: TopRoutes | null;
  journal: Journal | null;
};

const EMPTY: HomeData = {
  handle: null, gamelog: null, inventory: null, meta: {}, top: [], insurance: [], fleet: null, channels: [],
  uexAgeHours: null, hangar: null, servers: null, news: [], routes: null, journal: null,
};

const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export function useHomeData(): HomeData {
  const [data, setData] = useState<HomeData>(EMPTY);
  const patch = (part: Partial<HomeData>) => setData((d) => ({ ...d, ...part }));

  const load = useCallback(async () => {
    const accountId = await safe(invoke<string | null>("get_active_account_id"), null);
    void safe(invoke<{ id: string; handle: string }[]>("get_accounts"), []).then((a) =>
      patch({ handle: a.find((x) => x.id === accountId)?.handle ?? null }),
    );
    void safe(invoke<HomeData["gamelog"]>("get_gamelog_status"), null).then((gamelog) => patch({ gamelog }));
    void safe(invoke<InvState>("inventory_state"), null).then(async (inventory) => {
      if (!inventory) return;
      const top = topItems(inventory.possessions, 4);
      patch({ inventory, top });
      if (top.length) patch({ meta: await safe(invoke<Record<string, ItemMeta>>("inventory_item_meta", { classes: top.map((x) => x.classe) }), {}) });
    });
    if (accountId) {
      void safe(invoke<InsuranceShip[]>("get_insurance_ships", { accountId }), []).then((s) => patch({ insurance: s.map(buildInsuranceRow) }));
      void safe(invoke<{ shipsCount: number; ltiCount: number }>("get_dashboard_data", { accountId }), null).then((fleet) => patch({ fleet }));
    }
    void safe(invoke<Channel[]>("translation_channels"), []).then((channels) => patch({ channels }));
    void safe(invoke<{ freshestTimestamp: string | null }>("get_uex_prices_status"), null).then((u) => {
      const t = u?.freshestTimestamp ? Date.parse(u.freshestTimestamp) : NaN;
      patch({ uexAgeHours: Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000 });
    });
    void safe(invoke<HangarStatus>("get_hangar_exec_status"), null).then((hangar) => patch({ hangar }));
    void safe(invoke<RsiServerStatus>("get_rsi_server_status"), null).then((servers) => patch({ servers }));
    void safe(invoke<NewsItem[]>("get_rsi_news", { limit: 3, force: false }), []).then((news) => patch({ news }));
    void safe(invoke<TopRoutes | null>("get_dashboard_top_routes", { limit: 1 }), null).then((routes) => patch({ routes }));
    void safe(invoke<Journal>("get_journal_overview"), null).then((journal) => patch({ journal }));
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void safe(invoke<HomeData["gamelog"]>("get_gamelog_status"), null).then((gamelog) => patch({ gamelog }));
    }, 30_000);
    const un = listen("inventory:updated", () => void load());
    return () => {
      window.clearInterval(timer);
      void un.then((f) => f());
    };
  }, [load]);

  return data;
}
