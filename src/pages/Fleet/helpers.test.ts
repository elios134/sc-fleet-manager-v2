import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { acqBadge, formatPriceUsd, insuranceBadge, rentalDaysLeft, shipInsRank } from "./helpers";
import type { ShipRow } from "./types";

const t = ((k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k)) as unknown as TFunction;
const ship = (over: Partial<ShipRow>) => ({ lti: 0, insuranceDuration: null, acquisition: "rsi", rentalExpiresAt: null, ...over }) as ShipRow;
const sqlite = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

describe("assurance", () => {
  it("rang : LTI d'abord, puis plus de mois, inconnu en dernier", () => {
    const ranks = [ship({ insuranceDuration: 6 }), ship({ lti: 1 }), ship({}), ship({ insuranceDuration: 120 })].map(shipInsRank);
    expect(ranks).toEqual([994, 0, 9999, 880]);
  });
  it("pastille : à vie, mois (≥ 6 jaune, < 6 ou inconnue rouge)", () => {
    expect(insuranceBadge(ship({ lti: 1 }), t).label).toBe("shipCard.insuranceLifetime");
    expect(insuranceBadge(ship({ insuranceDuration: 24 }), t).color).toBe("#ffcf7a");
    expect(insuranceBadge(ship({ insuranceDuration: 3 }), t).color).toBe("#ff9a9a");
    expect(insuranceBadge(ship({}), t).label).toBe("shipCard.insuranceUnknown");
  });
});

describe("location", () => {
  it("jours restants depuis une date SQLite UTC ; absente ou invalide → null", () => {
    expect(rentalDaysLeft(sqlite(new Date(Date.now() + 2.5 * 86_400_000)))).toBe(3);
    expect(rentalDaysLeft(null)).toBeNull();
    expect(rentalDaysLeft("n'importe quoi")).toBeNull();
  });
  it("badge : acheté, loué (compte à rebours), location expirée, rien pour RSI", () => {
    expect(acqBadge(ship({ acquisition: "bought" }), t)?.label).toBe("shipCard.acqBought");
    expect(acqBadge(ship({ acquisition: "rented", rentalExpiresAt: sqlite(new Date(Date.now() + 86_400_000 * 1.5)) }), t)?.label).toBe(
      'shipCard.acqRentedExpiresIn:{"days":2}',
    );
    expect(acqBadge(ship({ acquisition: "rented", rentalExpiresAt: sqlite(new Date(Date.now() - 86_400_000)) }), t)?.label).toBe(
      "shipCard.acqRentedExpired",
    );
    expect(acqBadge(ship({}), t)).toBeNull();
  });
});

describe("prix", () => {
  it("montant USD arrondi avec séparateur de milliers", () => {
    expect(formatPriceUsd(1234.6)).toBe("1,235 $");
  });
});
