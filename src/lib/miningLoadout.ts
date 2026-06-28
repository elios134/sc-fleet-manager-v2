// Logique pure du planificateur de minage (loadout). Faits de jeu + formule de
// stacking ; implémentation originale (clean-room, inspiré de Stelliverse, aucun
// code repris). La donnée lasers/modules/gadgets vient de la commande Rust
// get_mining_loadout (source UEX). Le calcul tourne ici pour rester interactif.

export type BuyPoint = { terminal: string; price: number };
export type Laser = {
  name: string;
  company: string;
  size: number;
  minPower: number | null;
  maxPower: number | null;
  extPower: number | null;
  optRange: number | null;
  maxRange: number | null;
  resistance: number | null;
  instability: number | null;
  inert: number | null;
  chargeWindow: number | null;
  chargeRate: number | null;
  moduleSlots: number;
  price: number;
  buy: BuyPoint[];
};
export type MiningModule = {
  name: string;
  type: string; // "Active" | "Passive"
  powerPct: number | null;
  extPowerPct: number | null;
  resistance: number | null;
  instability: number | null;
  inert: number | null;
  chargeRate: number | null;
  chargeWindow: number | null;
  overcharge: number | null;
  shatter: number | null;
  uses: number;
  duration: number | null;
  price: number;
  buy: BuyPoint[];
};
export type Gadget = {
  name: string;
  chargeWindow: number | null;
  chargeRate: number | null;
  instability: number | null;
  resistance: number | null;
  cluster: number | null;
  price: number;
  buy: BuyPoint[];
};
export type MiningData = {
  lasers: Laser[];
  modules: MiningModule[];
  gadgets: Gadget[];
  generatedUnix?: number;
};

export type Turret = { laser: string; modules: string[] };
export type LMap = Record<string, Laser>;
export type MMap = Record<string, MiningModule>;
export type GMap = Record<string, Gadget>;

export type ShipCfg = {
  turrets: string[];
  size: number;
  slots: number;
  stock: string;
  fixed?: boolean;
  na?: string;
  src?: string;
  info?: string;
};

// Plateformes de minage (faits de jeu : tourelles, taille de laser, slots).
export const SHIPS: Record<string, ShipCfg> = {
  Prospector: { turrets: ["Tourelle principale"], size: 1, slots: 2, stock: "Arbor MH1 Mining Laser" },
  MOLE: {
    turrets: ["Tourelle avant", "Tourelle bâbord", "Tourelle tribord"],
    size: 2,
    slots: 2,
    stock: "Arbor MH2 Mining Laser",
  },
  Golem: { turrets: ["Tourelle principale"], size: 1, slots: 2, stock: "Pitman Mining Laser" },
  Arrastra: { turrets: ["Tourelle pivotante"], size: 2, slots: 2, stock: "", na: "pas encore pilotable" },
  ROC: {
    turrets: ["Greycat ROC Mining Head"],
    size: 0,
    slots: 0,
    stock: "",
    fixed: true,
    src: "scunpacked",
    info: "Véhicule terrestre 1 place. Laser minier Greycat S0 intégré (faisceau fixe) — tête non changeable, pas de modules. Petits gisements de surface (gemmes).",
  },
  "ROC DS": {
    turrets: ["Greycat ROC Mining Head"],
    size: 0,
    slots: 0,
    stock: "",
    fixed: true,
    src: "scunpacked",
    info: "Version 2 places (pilote + opérateur). Même laser Greycat S0 fixe que le ROC.",
  },
  "ATLS GEO": {
    turrets: ["Bras minier Argo"],
    size: 0,
    slots: 0,
    stock: "",
    fixed: true,
    info: "Exosuit minier Argo. Bras minier intégré, faisceau fixe. Stats détaillées non publiques pour l'instant.",
  },
  "À pied": { turrets: ["Multi-outil"], size: 0, slots: 2, stock: "" },
};

// Direction « bénéfique » de chaque modificateur (+1 = plus haut est mieux).
export const GOOD: Record<string, number> = {
  resistance: -1,
  instability: -1,
  inert: -1,
  chargeWindow: 1,
  chargeRate: 1,
  overcharge: -1,
  shatter: 1,
  cluster: 1,
};
export const STAT_LABELS: Array<[string, string]> = [
  ["resistance", "Résistance"],
  ["instability", "Instabilité"],
  ["chargeWindow", "Fenêtre de charge"],
  ["chargeRate", "Vitesse de charge"],
  ["shatter", "Éclatement"],
  ["overcharge", "Surcharge"],
  ["inert", "Matériau inerte"],
];

export type Stats = {
  minP: number;
  maxP: number;
  extP: number;
  optRange: number | null;
  resistance: number;
  instability: number;
  inert: number;
  chargeWindow: number;
  chargeRate: number;
  overcharge: number;
  shatter: number;
  cluster: number;
};

/** Stacking multiplicatif : ∏(1+v/100) − 1, exprimé en %. */
export function multStack(vals: number[]): number {
  let r = 1;
  for (const v of vals) if (v) r *= 1 + v / 100;
  return (r - 1) * 100;
}

/** Puissance d'une tourelle : maxPower du laser × (1 + Σ deltas de puissance des modules). */
export function turretPower(t: Turret, L: LMap, M: MMap): number {
  const l = L[t.laser];
  if (!l) return 0;
  let delta = 0;
  for (const mn of t.modules) {
    const m = M[mn];
    if (m && m.powerPct != null) delta += (m.powerPct - 100) / 100;
  }
  return (l.maxPower ?? 0) * (1 + delta);
}

/** Stats combinées de tout le loadout (puissance additive par tourelle, % en stacking). */
export function calc(loadout: Turret[], gadget: string, L: LMap, M: MMap, G: GMap): Stats {
  let minP = 0;
  let maxP = 0;
  let extP = 0;
  const res: number[] = [];
  const inst: number[] = [];
  const inert: number[] = [];
  const cw: number[] = [];
  const cr: number[] = [];
  const oc: number[] = [];
  const shat: number[] = [];
  const clus: number[] = [];

  for (const t of loadout) {
    const l = L[t.laser];
    if (!l) continue;
    let pd = 0;
    let ed = 0;
    for (const mn of t.modules) {
      const m = M[mn];
      if (!m) continue;
      if (m.powerPct != null) pd += (m.powerPct - 100) / 100;
      if (m.extPowerPct != null) ed += (m.extPowerPct - 100) / 100;
    }
    minP += (l.minPower ?? 0) * (1 + pd);
    maxP += (l.maxPower ?? 0) * (1 + pd);
    extP += (l.extPower ?? 0) * (1 + ed);
    if (l.resistance != null) res.push(l.resistance);
    if (l.instability != null) inst.push(l.instability);
    if (l.inert != null) inert.push(l.inert);
    if (l.chargeWindow != null) cw.push(l.chargeWindow);
    if (l.chargeRate != null) cr.push(l.chargeRate);
    // modules de CETTE tourelle : somme additive → un terme multiplicatif
    let tr = 0;
    let ti = 0;
    let tin = 0;
    let tcw = 0;
    let tcr = 0;
    let toc = 0;
    let tsh = 0;
    for (const mn of t.modules) {
      const m = M[mn];
      if (!m) continue;
      tr += m.resistance ?? 0;
      ti += m.instability ?? 0;
      tin += m.inert ?? 0;
      tcw += m.chargeWindow ?? 0;
      tcr += m.chargeRate ?? 0;
      toc += m.overcharge ?? 0;
      tsh += m.shatter ?? 0;
    }
    if (tr) res.push(tr);
    if (ti) inst.push(ti);
    if (tin) inert.push(tin);
    if (tcw) cw.push(tcw);
    if (tcr) cr.push(tcr);
    if (toc) oc.push(toc);
    if (tsh) shat.push(tsh);
  }

  const g = G[gadget];
  if (g) {
    if (g.resistance != null) res.push(g.resistance);
    if (g.instability != null) inst.push(g.instability);
    if (g.chargeWindow != null) cw.push(g.chargeWindow);
    if (g.chargeRate != null) cr.push(g.chargeRate);
    if (g.cluster != null) clus.push(g.cluster);
  }

  const first = loadout.map((t) => L[t.laser]).find(Boolean);
  return {
    minP,
    maxP,
    extP,
    optRange: first ? first.optRange : null,
    resistance: multStack(res),
    instability: multStack(inst),
    inert: multStack(inert),
    chargeWindow: multStack(cw),
    chargeRate: multStack(cr),
    overcharge: multStack(oc),
    shatter: multStack(shat),
    cluster: multStack(clus),
  };
}

/** Prix total du loadout (le laser de base de la plateforme est gratuit). */
export function totalPrice(loadout: Turret[], gadget: string, stock: string, L: LMap, M: MMap, G: GMap): number {
  let tot = 0;
  for (const t of loadout) {
    const l = L[t.laser];
    if (l && l.name !== stock) tot += l.price ?? 0;
    for (const mn of t.modules) {
      const m = M[mn];
      if (m) tot += m.price ?? 0;
    }
  }
  const g = G[gadget];
  if (g) tot += g.price ?? 0;
  return tot;
}

/** Loadout initial d'une plateforme : laser de base pré-rempli, slots vides. */
export function freshLoadout(ship: string): { loadout: Turret[]; gadget: string } {
  const cfg = SHIPS[ship] ?? SHIPS.Prospector;
  return {
    loadout: cfg.turrets.map(() => ({ laser: cfg.stock || "", modules: Array(cfg.slots).fill("") })),
    gadget: "",
  };
}

export function indexByName<T extends { name: string }>(arr: T[]): Record<string, T> {
  const m: Record<string, T> = {};
  for (const x of arr) m[x.name] = x;
  return m;
}
