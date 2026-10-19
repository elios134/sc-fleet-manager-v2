import { describe, it, expect } from "vitest";
import { SECTIONS, sectionFromHash } from "./sections";
import { accountTone, dataFreshnessSummary, dataTone } from "./status";

describe("sectionFromHash", () => {
  it("ancres actuelles, ancre héritée #datamining → jeu, inconnue → compte", () => {
    expect(sectionFromHash("#donnees", false)).toBe("donnees");
    expect(sectionFromHash("#datamining", false)).toBe("jeu");
    expect(sectionFromHash("#jeu", false)).toBe("jeu");
    expect(sectionFromHash("", false)).toBe("compte");
    expect(sectionFromHash("#inconnu", false)).toBe("compte");
  });
  it("diagnostic seulement en dev", () => {
    expect(sectionFromHash("#diagnostic", true)).toBe("diagnostic");
    expect(sectionFromHash("#diagnostic", false)).toBe("compte");
  });
});

describe("SECTIONS", () => {
  it("ordre, groupes, diagnostic réservé au dev", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(["compte", "apparence", "donnees", "jeu", "notifs", "apropos", "diagnostic"]);
    expect(SECTIONS.filter((s) => s.group === "moi").map((s) => s.key)).toEqual(["compte", "apparence"]);
    expect(SECTIONS.find((s) => s.key === "diagnostic")?.devOnly).toBe(true);
  });
});

describe("bandeau d'état", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const STALE = 14 * 86_400_000;
  it("dataFreshnessSummary : à jour / à rafraîchir / jamais (date invalide = jamais)", () => {
    expect(dataFreshnessSummary({ wiki: ago(2), cargo: ago(20), uex: null }, now, STALE)).toEqual({ ok: 1, stale: 1, never: 1 });
    expect(dataFreshnessSummary({ wiki: "pas une date" }, now, STALE)).toEqual({ ok: 0, stale: 0, never: 1 });
  });
  it("dataTone et accountTone", () => {
    expect(dataTone({ ok: 3, stale: 0, never: 0 })).toBe("ok");
    expect(dataTone({ ok: 2, stale: 1, never: 0 })).toBe("warn");
    expect(dataTone({ ok: 0, stale: 0, never: 3 })).toBe("warn");
    expect(accountTone(null)).toBe("off");
    expect(accountTone({ sessionActive: false })).toBe("off");
    expect(accountTone({ sessionActive: true })).toBe("ok");
  });
});
