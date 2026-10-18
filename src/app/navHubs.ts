// Navigation regroupée : 9 hubs à onglets (19 entrées → 9). Table pure (sans composants
// de page) : routes, redirections des anciennes URL, migration des épingles.
import { Boxes, FileText, Gamepad2, Map, Pickaxe, Rocket, Store, Truck, Wrench, type LucideIcon } from "lucide-react";

export type HubTab = { key: string; labelKey: string; legacy: string };
export type Hub = { key: string; path: string; icon: LucideIcon; labelKey: string; descKey: string; tabs: HubTab[] };

const tab = (key: string, legacy: string): HubTab => ({ key, labelKey: `nav.tab.${key}`, legacy });
const hub = (key: string, icon: LucideIcon, tabs: HubTab[]): Hub => ({
  key,
  path: `/${key}`,
  icon,
  labelKey: `nav.hub.${key}`,
  descKey: `nav.hubDesc.${key}`,
  tabs,
});

export const HUBS: Hub[] = [
  hub("fleet", Rocket, [tab("ma-flotte", "/fleet"), tab("assurances", "/insurance"), tab("ccu", "/ccu-chain")]),
  hub("ships", Wrench, [tab("configurateur", "/loadout"), tab("comparateur", "/comparator"), tab("3d", "/ship3d")]),
  hub("starmap", Map, []),
  hub("inventory", Boxes, []),
  hub("missions", FileText, [tab("hub", "/intel"), tab("carnet", "/journal")]),
  hub("commerce", Truck, [tab("cargo", "/cargo-routes"), tab("hangar-exec", "/hangar-exec")]),
  hub("industry", Pickaxe, [tab("minage", "/mining"), tab("crafting", "/crafting")]),
  hub("market", Store, [tab("objets", "/catalogue"), tab("cosmetiques", "/items")]),
  hub("tools", Gamepad2, [tab("traduction", "/translation"), tab("overlay", "/overlay")]),
];

/** Routes sorties de la navigation (accessibles par lien, plus épinglables). */
const DROPPED = new Set(["/news"]);

export function hubTabPath(hubKey: string, tabKey: string): string {
  return `/${hubKey}/${tabKey}`;
}

/** Ancienne route → « /hub/onglet » ; null si inconnue ou si c'est déjà une route de hub. */
export function legacyRedirect(path: string): string | null {
  if (HUBS.some((h) => h.path === path)) return null;
  for (const h of HUBS) {
    const t = h.tabs.find((x) => x.legacy === path);
    if (t) return hubTabPath(h.key, t.key);
  }
  return null;
}

/** Épingles enregistrées → nouvelles routes (ordre conservé, sans doublon ni route retirée). */
export function migratePinned(routes: string[]): string[] {
  const out: string[] = [];
  for (const r of routes) {
    if (DROPPED.has(r)) continue;
    const next = legacyRedirect(r) ?? r;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}
