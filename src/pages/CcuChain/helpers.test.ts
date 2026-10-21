import { afterEach, describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { displayTaxMultiplier, fmtMoney, fmtMoneyDelta, fmtPct, parseSyncMs, relativeAge, shipName } from "./helpers";
import type { CcuShip } from "./types";

const t = ((k: string, o?: { count?: number }) => (o?.count != null ? `${k}:${o.count}` : k)) as unknown as TFunction;
const sqliteAgo = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace("T", " ");

afterEach(() => {
  displayTaxMultiplier.mult = 1;
});

describe("montants CCU", () => {
  it("cents → dollars, TVA d'affichage appliquée", () => {
    expect(fmtMoney(27500)).toBe("$275");
    displayTaxMultiplier.mult = 1.2;
    expect(fmtMoney(10000)).toBe("$120");
  });
  it("delta signé et pourcentage d'une référence", () => {
    expect(fmtMoneyDelta(-7300)).toBe("-$73");
    expect(fmtMoneyDelta(2300)).toBe("+$23");
    expect(fmtPct(-7300, 76000)).toBe("-9.6%");
    expect(fmtPct(500, 0)).toBe("");
    expect(fmtPct(500, null)).toBe("");
  });
});

describe("âge de la synchro", () => {
  it("date SQLite UTC ; vide ou invalide → null", () => {
    expect(parseSyncMs("2026-10-19 12:00:00")).toBe(Date.UTC(2026, 9, 19, 12));
    expect(parseSyncMs(null)).toBeNull();
    expect(parseSyncMs("pas une date")).toBeNull();
  });
  it("jamais, à l'instant, minutes, heures, jours", () => {
    expect(relativeAge(null, t)).toBe("ccu.never");
    expect(relativeAge(sqliteAgo(10_000), t)).toBe("ccu.justNow");
    expect(relativeAge(sqliteAgo(5 * 60_000), t)).toBe("ccu.minsAgo:5");
    expect(relativeAge(sqliteAgo(3 * 3_600_000), t)).toBe("ccu.hoursAgo:3");
    expect(relativeAge(sqliteAgo(2 * 86_400_000), t)).toBe("ccu.daysAgo:2");
  });
});

describe("shipName", () => {
  it("nom connu, sinon identifiant", () => {
    const m = new Map([[7, { shipId: 7, name: "Cutlass Black" } as CcuShip]]);
    expect(shipName(m, 7)).toBe("Cutlass Black");
    expect(shipName(m, 9)).toBe("Ship #9");
  });
});
