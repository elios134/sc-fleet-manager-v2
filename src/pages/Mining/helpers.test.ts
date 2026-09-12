import { describe, it, expect } from "vitest";
import { toSellPoints, priceOf, scanValue, evalMethod, rankMethods, fmtDur } from "./helpers";
import { FALLBACK_SELL, methodByKey } from "../../lib/miningRegistry";
import type { OreLine, RefinerySellRow } from "./types";

const rows: RefinerySellRow[] = [
  { commodityName: "Titanium", terminal: "ARC-L1", system: "Stanton", priceSell: 400, scuDemand: 5000, updatedAt: null },
  { commodityName: "Titanium", terminal: "CRU-L1", system: "Stanton", priceSell: 460, scuDemand: 3000, updatedAt: null },
  { commodityName: "Quantanium", terminal: "HUR-L2", system: "Stanton", priceSell: 9000, scuDemand: 200, updatedAt: null },
];

describe("toSellPoints", () => {
  it("garde le meilleur prix par commodity et mappe vers la clé minéral", () => {
    const s = toSellPoints(rows);
    expect(s.titanium.priceSell).toBe(460);
    expect(s.titanium.terminal).toBe("CRU-L1");
    expect(s.titanium.live).toBe(true);
    expect(s.quantanium.priceSell).toBe(9000);
    expect(s.iron).toBeUndefined(); // absent de UEX
  });
});

describe("priceOf", () => {
  it("prend le prix live si dispo", () => {
    expect(priceOf("titanium", toSellPoints(rows))).toBe(460);
  });
  it("retombe sur le repli statique sinon", () => {
    expect(priceOf("iron", {})).toBe(FALLBACK_SELL.iron);
  });
});

describe("scanValue", () => {
  it("somme scu × prix raffiné plein", () => {
    const ore: OreLine[] = [
      { key: "titanium", scu: 10 },
      { key: "iron", scu: 5 },
    ];
    const s = toSellPoints(rows);
    expect(scanValue(ore, s)).toBe(10 * 460 + 5 * FALLBACK_SELL.iron);
  });
  it("ignore les lignes vides ou inconnues", () => {
    expect(scanValue([{ key: "titanium", scu: 0 }, { key: "zzz", scu: 5 }], {})).toBe(0);
  });
});

describe("evalMethod", () => {
  it("applique le yield au raffiné et calcule le net", () => {
    const ore: OreLine[] = [{ key: "titanium", scu: 10 }];
    const dinyx = evalMethod(ore, "dinyx", toSellPoints(rows))!;
    expect(dinyx.refinedScu).toBeCloseTo(10 * methodByKey.dinyx.yieldMult);
    expect(dinyx.revenue).toBeCloseTo(10 * methodByKey.dinyx.yieldMult * 460);
    expect(dinyx.net).toBeCloseTo(dinyx.revenue - dinyx.cost);
    expect(dinyx.durationSecs).toBeGreaterThan(0);
  });
  it("Dinyx (yield haut) raffine plus que Cormack (yield bas) pour le même brut", () => {
    const ore: OreLine[] = [{ key: "quantanium", scu: 32 }];
    const s = toSellPoints(rows);
    expect(evalMethod(ore, "dinyx", s)!.refinedScu).toBeGreaterThan(evalMethod(ore, "cormack", s)!.refinedScu);
  });
  it("Cormack (rapide) est plus court que Dinyx (très lent)", () => {
    const ore: OreLine[] = [{ key: "quantanium", scu: 32 }];
    const s = toSellPoints(rows);
    expect(evalMethod(ore, "cormack", s)!.durationSecs).toBeLessThan(evalMethod(ore, "dinyx", s)!.durationSecs);
  });
  it("renvoie null pour une méthode inconnue", () => {
    expect(evalMethod([{ key: "iron", scu: 1 }], "nope", {})).toBeNull();
  });
});

describe("rankMethods", () => {
  it("renvoie les 9 méthodes triées par net décroissant par défaut", () => {
    const r = rankMethods([{ key: "quantanium", scu: 32 }], toSellPoints(rows));
    expect(r).toHaveLength(9);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].net).toBeGreaterThanOrEqual(r[i].net);
  });
  it("le tri par netPerHour peut différer du tri par net", () => {
    const ore: OreLine[] = [{ key: "quantanium", scu: 32 }];
    const s = toSellPoints(rows);
    const byNet = rankMethods(ore, s, "net");
    const byHour = rankMethods(ore, s, "netPerHour");
    for (let i = 1; i < byHour.length; i++) expect(byHour[i - 1].netPerHour).toBeGreaterThanOrEqual(byHour[i].netPerHour);
    // profils différents → l'ordre n'est pas forcément identique
    expect(byNet.map((m) => m.key)).not.toEqual([]);
  });
});

describe("fmtDur", () => {
  it("formate heures et minutes", () => {
    expect(fmtDur(3600 + 5 * 60)).toBe("1h 05m");
    expect(fmtDur(45 * 60)).toBe("45m");
    expect(fmtDur(0)).toBe("0m");
  });
});
