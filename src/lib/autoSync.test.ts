import { describe, expect, it } from "vitest";
import { isAutoSyncEnabled, planAutoSync } from "./autoSync";

describe("isAutoSyncEnabled", () => {
  it("allumé par défaut, éteint seulement sur « 0 »", () => {
    expect(isAutoSyncEnabled(null)).toBe(true);
    expect(isAutoSyncEnabled("1")).toBe(true);
    expect(isAutoSyncEnabled("0")).toBe(false);
  });
});

describe("planAutoSync", () => {
  const base = { installedChangenum: 200, patchStatus: "up_to_date" as const, done: { wiki: 200, cargo: 200 } };

  it("même patch : prix UEX seulement", () => {
    expect(planAutoSync(base)).toEqual({ sources: ["uex"], seed: [], patch: false });
  });

  it("nouveau patch : wiki, cargo puis UEX", () => {
    expect(planAutoSync({ ...base, installedChangenum: 300, patchStatus: "patch_detected" })).toEqual({
      sources: ["wiki", "cargo", "uex"],
      seed: [],
      patch: true,
    });
  });

  it("nouveau patch même si le wiki n'est pas encore à jour (statut inconnu)", () => {
    expect(planAutoSync({ ...base, installedChangenum: 300, patchStatus: "unknown" }).sources).toEqual(["wiki", "cargo", "uex"]);
  });

  it("une source déjà réussie pour ce patch n'est pas relancée", () => {
    expect(planAutoSync({ ...base, installedChangenum: 300, done: { wiki: 300, cargo: 200 } })).toEqual({
      sources: ["cargo", "uex"],
      seed: [],
      patch: true,
    });
  });

  it("sans marqueur : synchro si le wiki est en retard sur le jeu", () => {
    expect(planAutoSync({ installedChangenum: 300, patchStatus: "patch_detected", done: { wiki: null, cargo: null } }).sources).toEqual([
      "wiki",
      "cargo",
      "uex",
    ]);
  });

  it("sans marqueur et données à jour : on pose le marqueur sans synchroniser", () => {
    expect(planAutoSync({ installedChangenum: 300, patchStatus: "up_to_date", done: { wiki: null, cargo: 300 } })).toEqual({
      sources: ["uex"],
      seed: ["wiki"],
      patch: false,
    });
  });

  it("jeu introuvable : prix UEX seulement", () => {
    expect(planAutoSync({ installedChangenum: null, patchStatus: "unknown", done: { wiki: null, cargo: null } })).toEqual({
      sources: ["uex"],
      seed: [],
      patch: false,
    });
  });
});
