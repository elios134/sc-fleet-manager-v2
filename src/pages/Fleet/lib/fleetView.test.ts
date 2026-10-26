import { describe, expect, it } from "vitest";
import { fleetKpis, insuranceTone } from "./fleetView";
import type { ShipRow } from "../types";

const ship = (p: Partial<ShipRow>): ShipRow => ({
  id: 1, name: "X", manufacturer: "M", role: "MULTI", lti: 0, insuranceDuration: 120, insuranceExpiry: null, imageUrl: null, imageTopDownUrl: null,
  shipDataRole: null, shipDataManufacturer: null, shipDataClassification: null, shipDataFocus: null, shipDataSize: null,
  crewMin: 1, crewMax: 1, cargoScu: 0, mass: null, length: null, beam: null, height: null, scmSpeed: null, maxSpeed: null,
  shieldHp: null, hullHp: null, baseDps: null, emSignature: null, irSignature: null, currentValueUsd: null, isUpgraded: null, isBuybackable: null,
  acquisition: "rsi", shipDataId: null, rentalExpiresAt: null, rentalDurationDays: null, ...p,
});

describe("insuranceTone", () => {
  it("LTI, location, assurance courte (< 12 mois), inconnue, normale", () => {
    expect(insuranceTone(ship({ lti: 1, insuranceDuration: null }))).toBe("lti");
    expect(insuranceTone(ship({ acquisition: "rented" }))).toBe("rental");
    expect(insuranceTone(ship({ insuranceDuration: 6 }))).toBe("short");
    expect(insuranceTone(ship({ insuranceDuration: null }))).toBe("unknown");
    expect(insuranceTone(ship({ insuranceDuration: 120 }))).toBe("ok");
  });
});

describe("fleetKpis", () => {
  it("compte, cargo total, équipage max cumulé et assurances courtes", () => {
    const ships = [
      ship({ cargoScu: 96, crewMax: 6 }),
      ship({ cargoScu: 12, crewMax: 1, lti: 1, insuranceDuration: null }),
      ship({ cargoScu: null, crewMax: null, insuranceDuration: 6 }),
      ship({ cargoScu: 2, crewMax: 1, insuranceDuration: 6, acquisition: "rented" }),
    ];
    expect(fleetKpis(ships)).toEqual({ count: 4, cargo: 110, crew: 8, shortInsurance: 1 });
  });
});
