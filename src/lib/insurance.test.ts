import { describe, it, expect } from "vitest";
import {
  getInsuranceStatus,
  getInsuranceDaysLeft,
  formatInsuranceType,
  addMonths,
  uiStatusFrom,
  formatExpiryLabel,
  sortByUrgency,
  type InsuranceRow,
} from "./insurance";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("getInsuranceStatus", () => {
  it("null → ok (LTI/sans expiration)", () => expect(getInsuranceStatus(null)).toBe("ok"));
  it("passé → expired", () => expect(getInsuranceStatus(inDays(-1))).toBe("expired"));
  it("< 7 j → critical", () => expect(getInsuranceStatus(inDays(3))).toBe("critical"));
  it("< 30 j → warning", () => expect(getInsuranceStatus(inDays(15))).toBe("warning"));
  it("> 30 j → ok", () => expect(getInsuranceStatus(inDays(60))).toBe("ok"));
});

describe("getInsuranceDaysLeft", () => {
  it("null → null", () => expect(getInsuranceDaysLeft(null)).toBeNull());
  it("compte les jours restants (floor)", () => expect([9, 10]).toContain(getInsuranceDaysLeft(inDays(10)))); // ~10, floor → 9/10 selon timing
});

describe("formatInsuranceType", () => {
  it("LTI", () => expect(formatInsuranceType(true, 12)).toBe("LTI"));
  it("SHI avec mois", () => expect(formatInsuranceType(false, 6)).toBe("SHI (6M)"));
  it("SHI sans mois", () => expect(formatInsuranceType(false, null)).toBe("SHI"));
});

describe("addMonths", () => {
  it("ajoute n mois", () => {
    expect(addMonths(new Date("2026-01-15T00:00:00Z"), 3).getUTCMonth()).toBe(3); // avril (0-based)
  });
});

describe("uiStatusFrom", () => {
  it("expired → EXPIRED", () => expect(uiStatusFrom("expired", -5)).toBe("EXPIRED"));
  it("ok → ACTIVE", () => expect(uiStatusFrom("ok", 100)).toBe("ACTIVE"));
  it("warning/critical < 30 j → WARNING", () => expect(uiStatusFrom("warning", 10)).toBe("WARNING"));
});

describe("formatExpiryLabel", () => {
  const base = { id: 1, name: "x", manufacturer: "y", insuranceDuration: null };
  it("LTI → vide", () => expect(formatExpiryLabel({ ...base, lti: 1, insuranceExpiry: null })).toBe(""));
  it("sans expiration → tiret", () => expect(formatExpiryLabel({ ...base, lti: 0, insuranceExpiry: null })).toBe("—"));
  it("date invalide → tiret", () => expect(formatExpiryLabel({ ...base, lti: 0, insuranceExpiry: "pas-une-date" })).toBe("—"));
  it("date valide → YYYY-MM-DD", () => expect(formatExpiryLabel({ ...base, lti: 0, insuranceExpiry: "2026-05-10T12:00:00Z" })).toBe("2026-05-10"));
});

describe("sortByUrgency", () => {
  const row = (status: InsuranceRow["status"], expiryIso: string | null): InsuranceRow => ({
    shipId: 0, name: "", manufacturer: "", lti: false, insuranceDuration: null,
    typeLabel: "", expiryLabel: "", status, daysLeft: null, expiryIso,
  });
  it("EXPIRED puis WARNING puis ACTIVE", () => {
    const out = sortByUrgency([row("ACTIVE", null), row("EXPIRED", null), row("WARNING", null)]);
    expect(out.map((r) => r.status)).toEqual(["EXPIRED", "WARNING", "ACTIVE"]);
  });
  it("à statut égal, expiration la plus proche d'abord", () => {
    const out = sortByUrgency([row("WARNING", "2026-12-01"), row("WARNING", "2026-06-01")]);
    expect(out.map((r) => r.expiryIso)).toEqual(["2026-06-01", "2026-12-01"]);
  });
});
