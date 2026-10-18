// Duel entre deux vaisseaux : lignes de comparaison groupées, gagnant par ligne, score.
// (logique pure, testée)

export interface ShipDataRow {
  id: number;
  name: string;
  manufacturer: string;
  role: string;
  classification: string;
  focus: string;
  size: string | null;
  length: number | null;
  beam: number | null;
  height: number | null;
  maxSpeed: number | null;
  scmSpeed: number | null;
  shieldHp: number | null;
  hullHp: number | null;
  baseDps: number | null;
  cargoScu: number | null;
  quantumFuel: number | null;
  crewMin: number | null;
  crewMax: number | null;
  mass: number | null;
  priceUec: number | null;
  imageUrl: string | null;
  radarSpeed: number;
  radarFirepower: number;
  radarDefense: number;
  radarRange: number;
  radarAgility: number;
  radarUtility: number;
  emSignature: number | null;
  irSignature: number | null;
  crossSection: number | null;
}

export type CmpGroup = "vol" | "combat" | "logistique" | "discretion";
export type CmpRowDef = {
  key: string;
  group: CmpGroup;
  labelKey: string;
  get: (s: ShipDataRow) => number | null;
  lowerIsBetter?: boolean;
  fmt: (v: number) => string;
};
export type CmpResult = { key: string; a: number | null; b: number | null; winner: "a" | "b" | null; ratioA: number; ratioB: number };

const num = (suffix = "") => (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${suffix}`;

export const CMP_ROWS: CmpRowDef[] = [
  { key: "maxSpeed", group: "vol", labelKey: "comparator.row.maxSpeed", get: (s) => s.maxSpeed, fmt: num(" m/s") },
  { key: "scmSpeed", group: "vol", labelKey: "comparator.row.scmSpeed", get: (s) => s.scmSpeed, fmt: num(" m/s") },
  { key: "quantumFuel", group: "vol", labelKey: "comparator.row.quantumFuel", get: (s) => s.quantumFuel, fmt: num() },
  { key: "shields", group: "combat", labelKey: "comparator.row.shields", get: (s) => s.shieldHp, fmt: num(" HP") },
  { key: "hull", group: "combat", labelKey: "comparator.row.hull", get: (s) => s.hullHp, fmt: num(" HP") },
  { key: "dps", group: "combat", labelKey: "comparator.row.dps", get: (s) => s.baseDps, fmt: num() },
  { key: "cargo", group: "logistique", labelKey: "comparator.row.cargo", get: (s) => s.cargoScu, fmt: num(" SCU") },
  { key: "crew", group: "logistique", labelKey: "comparator.row.crew", get: (s) => s.crewMax, fmt: num() },
  { key: "priceUec", group: "logistique", labelKey: "comparator.row.priceUec", get: (s) => s.priceUec, lowerIsBetter: true, fmt: num(" aUEC") },
  { key: "mass", group: "logistique", labelKey: "comparator.row.mass", get: (s) => s.mass, lowerIsBetter: true, fmt: num(" kg") },
  { key: "emSignature", group: "discretion", labelKey: "comparator.row.emSignature", get: (s) => s.emSignature, lowerIsBetter: true, fmt: num() },
  { key: "irSignature", group: "discretion", labelKey: "comparator.row.irSignature", get: (s) => s.irSignature, lowerIsBetter: true, fmt: num() },
  { key: "crossSection", group: "discretion", labelKey: "comparator.row.crossSection", get: (s) => s.crossSection, lowerIsBetter: true, fmt: num() },
];

export function compareShips(
  a: ShipDataRow,
  b: ShipDataRow,
  rows: CmpRowDef[] = CMP_ROWS,
): { rows: CmpResult[]; winsA: number; winsB: number; comparable: number } {
  let winsA = 0, winsB = 0, comparable = 0;
  const out = rows.map((r) => {
    const va = r.get(a), vb = r.get(b);
    const max = Math.max(va ?? 0, vb ?? 0);
    const ratio = (v: number | null) => (v == null || max <= 0 ? 0 : v / max);
    let winner: "a" | "b" | null = null;
    if (va != null && vb != null) {
      comparable++;
      if (va !== vb) winner = (va > vb) !== !!r.lowerIsBetter ? "a" : "b";
      if (winner === "a") winsA++;
      if (winner === "b") winsB++;
    }
    return { key: r.key, a: va, b: vb, winner, ratioA: ratio(va), ratioB: ratio(vb) };
  });
  return { rows: out, winsA, winsB, comparable };
}
