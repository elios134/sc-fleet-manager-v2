// Ce qu'il manque pour fabriquer un plan (logique pure, testée) : besoin par ingrédient pour
// une quantité, possédé (saisie ou inventaire Game.log), manque ; lieux de minage rattachés à
// la carte et triés par méthode choisie puis distance.
import { bodyKey } from "../../../components/starmap3d/naming";
import { safeName, type StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import type { ItineraryStop } from "../../../components/starmap3d/itinerary";
import type { MiningLocation } from "../types";

export type Need = { ref: string; name: string; resource: boolean; need: number; owned: number; missing: number };
/** Méthode de minage choisie : ROC (véhicule), vaisseau, à pied. */
export type MineMethod = "roc" | "ship" | "fps";
export type MiningSpot = MiningLocation & { gm: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Besoin de chaque ingrédient pour `qty` fabrications (cumulé par ingrédient, ordre de la
 *  recette), possédé et manque. */
export function craftNeeds(
  ings: { ingredientRef: string; ingredientName: string; ingredientType: string; quantity: number }[],
  qty: number,
  owned: Record<string, number>,
): Need[] {
  const out: Need[] = [];
  for (const i of ings) {
    const cur = out.find((n) => n.ref === i.ingredientRef);
    if (cur) cur.need += i.quantity * qty;
    else out.push({ ref: i.ingredientRef, name: i.ingredientName, resource: i.ingredientType === "resource", need: i.quantity * qty, owned: 0, missing: 0 });
  }
  return out.map((n) => {
    const need = round2(n.need);
    const have = owned[n.ref] ?? 0;
    return { ...n, need, owned: have, missing: round2(Math.max(0, need - have)) };
  });
}

/** Mots d'un nom de classe ou d'objet (« Hadanite_Gem_01 » → hadanite, gem, 01). */
const words = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Quantité d'un objet dans l'inventaire Game.log (classes qui COMMENCENT par ses mots, tous
 *  lieux) ; null s'il n'y figure pas. Un simple « contient » comptait des caisses de mission
 *  (« ..._box_gold ») ou « environment » pour « Iron ». */
export function ownedFromInventory(name: string, possessions: Record<string, Record<string, { qte: number }>>): number | null {
  const k = words(name);
  if (!k.length) return null;
  let total = 0;
  let found = false;
  for (const stacks of Object.values(possessions)) {
    for (const [cls, s] of Object.entries(stacks)) {
      const w = words(cls);
      if (k.every((x, i) => w[i] === x)) {
        total += s.qte;
        found = true;
      }
    }
  }
  return found ? total : null;
}

/** Corps de la carte d'un lieu de minage : par son nom, sinon par la clé brute sans le
 *  préfixe de système (« nyx_glaciemring » → Glaciem Ring). null si absent de la carte. */
export function spotStop(s: MiningLocation, bodies: StarmapBodyItem[]): ItineraryStop | null {
  const system = s.systemName.toLowerCase();
  const raw = s.rawBodyKey.toLowerCase().replace(new RegExp(`^${system}_`), "");
  const keys = [bodyKey(s.bodyName), bodyKey(raw)].filter(Boolean);
  const body = bodies.find((b) => b.systemName.toLowerCase() === system && keys.includes(bodyKey(safeName(b))));
  return body ? { bodyId: body.id, poi: null } : null;
}

const METHOD: Record<MineMethod, string> = { roc: "ground_vehicle", ship: "ship", fps: "fps" };
const RARITY = ["common", "uncommon", "rare", "epic", "legendary"];
const rarityRank = (r: string | null) => (r && RARITY.includes(r) ? RARITY.indexOf(r) : RARITY.length);

/** Lieux de la méthode choisie d'abord, puis du plus proche au plus loin, puis du plus commun. */
export function sortSpots(spots: MiningSpot[], method: MineMethod): MiningSpot[] {
  const m = METHOD[method];
  return spots
    .slice()
    .sort(
      (a, b) =>
        Number(b.miningMethod === m) - Number(a.miningMethod === m) ||
        (a.gm ?? Infinity) - (b.gm ?? Infinity) ||
        rarityRank(a.rarity) - rarityRank(b.rarity),
    );
}
