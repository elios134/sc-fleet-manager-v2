import { describe, it, expect } from "vitest";
import { formatPriceUsd, rentalDaysLeft, shipInsRank } from "./helpers";
import type { ShipRow } from "./types";

const ship = (over: Partial<ShipRow>) => ({ lti: 0, insuranceDuration: null, acquisition: "rsi", rentalExpiresAt: null, ...over }) as ShipRow;
const sqlite = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

describe("assurance", () => {
  it("rang : LTI d'abord, puis plus de mois, inconnu en dernier", () => {
    const ranks = [ship({ insuranceDuration: 6 }), ship({ lti: 1 }), ship({}), ship({ insuranceDuration: 120 })].map(shipInsRank);
    expect(ranks).toEqual([994, 0, 9999, 880]);
  });
});

describe("location", () => {
  it("jours restants depuis une date SQLite UTC ; absente ou invalide → null", () => {
    expect(rentalDaysLeft(sqlite(new Date(Date.now() + 2.5 * 86_400_000)))).toBe(3);
    expect(rentalDaysLeft(null)).toBeNull();
    expect(rentalDaysLeft("n'importe quoi")).toBeNull();
  });
});

describe("prix", () => {
  it("montant USD arrondi avec séparateur de milliers", () => {
    expect(formatPriceUsd(1234.6)).toBe("1,235 $");
  });
});
