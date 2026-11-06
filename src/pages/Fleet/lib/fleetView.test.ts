import { describe, expect, it } from "vitest";
import { fleetKpis, fleetRows, insuranceTone } from "./fleetView";
import type { ShipRow } from "../types";

const ship = (p: Partial<ShipRow>): ShipRow => ({
  id: 1, name: "X", manufacturer: "M", role: "MULTI", lti: 0, insuranceDuration: 120, insuranceExpiry: null, imageUrl: null, imageTopDownUrl: null,
  shipDataRole: null, shipDataManufacturer: null, shipDataClassification: null, shipDataFocus: null, shipDataSize: null,
  crewMin: 1, crewMax: 1, cargoScu: 0, mass: null, length: null, beam: null, height: null, scmSpeed: null, maxSpeed: null,
  shieldHp: null, hullHp: null, baseDps: null, emSignature: null, irSignature: null, currentValueUsd: null, isUpgraded: null, isBuybackable: null,
  acquisition: "rsi", shipDataId: null, rentalExpiresAt: null, rentalDurationDays: null, packId: null, packName: null, packShipCount: null, ...p,
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

describe("fleetRows", () => {
  const pack = (id: number, name: string, p: Partial<ShipRow> = {}) =>
    ship({ id, name, packId: 9, packName: "Praetorian Pack", packShipCount: 3, currentValueUsd: 15710, ...p });
  const solo = ship({ id: 1, name: "Clipper", currentValueUsd: 150 });
  const all = [pack(2, "Idris", { cargoScu: 100, lti: 1 }), solo, pack(3, "Javelin", { cargoScu: 50, lti: 1 }), pack(4, "Nova", { lti: 0 })];

  it("un vaisseau seul garde sa ligne ; un pack n'a qu'une ligne, à la place de son premier vaisseau", () => {
    const rows = fleetRows(all, all);
    expect(rows.map((r) => (r.kind === "ship" ? r.ship.name : r.name))).toEqual(["Praetorian Pack", "Clipper"]);
  });

  it("la ligne du pack résume tout le pack : nombre de vaisseaux, LTI, cargo, valeur, premier vaisseau", () => {
    const [row] = fleetRows(all, all);
    expect(row).toMatchObject({ kind: "pack", packId: 9, shipCount: 3, ltiCount: 2, cargo: 150, valueUsd: 15710 });
    expect(row!.kind === "pack" && row!.firstShip.name).toBe("Idris");
  });

  it("filtre : le pack reste si un seul de ses vaisseaux correspond, avec ses totaux complets", () => {
    const rows = fleetRows([all[2]!], all);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "pack", shipCount: 3, cargo: 150 });
  });
});
