import { describe, it, expect } from "vitest";
import { bestRouteState, deriveAlerts, hasLogbook, hasServers, isFirstLogin, sessionState, sinceLabel, topItems } from "./home";
import type { InsuranceRow } from "../../lib/insurance";

const ins = (daysLeft: number | null, lti = false): InsuranceRow => ({
  shipId: Math.round(Math.random() * 1e6), name: `S${daysLeft}`, manufacturer: "", lti, insuranceDuration: 6,
  typeLabel: "", expiryLabel: "", status: "ACTIVE", daysLeft, expiryIso: null,
});
const base = { insurance: [] as InsuranceRow[], channels: [] as { label: string; install: { updateAvailable: boolean } | null }[], uexAgeHours: null as number | null, gamelogEnabled: true, gamelogPathExists: true };

describe("deriveAlerts", () => {
  it("rien à signaler → []", () => expect(deriveAlerts(base)).toEqual([]));
  it("ordre bad > warn, filtres d'échéance", () => {
    const a = deriveAlerts({
      ...base,
      insurance: [ins(5), ins(-2), ins(20), ins(null, true)],
      channels: [{ label: "LIVE", install: { updateAvailable: true } }],
    });
    expect(a.map((x) => x.kind)).toEqual(["insuranceExpired", "insuranceSoon", "translationUpdate"]);
  });
  it("prix UEX périmés", () => {
    expect(deriveAlerts({ ...base, uexAgeHours: 30 }).map((x) => x.kind)).toEqual(["uexStale"]);
  });
  it("Game.log coupé : alerte seulement si le jeu est installé", () => {
    expect(deriveAlerts({ ...base, gamelogEnabled: false, gamelogPathExists: false })).toEqual([]);
    expect(deriveAlerts({ ...base, gamelogEnabled: false, gamelogPathExists: true }).map((x) => x.kind)).toEqual(["gamelogOff"]);
  });
});

describe("sessionState", () => {
  const now = new Date("2026-10-18T16:40:00Z");
  it("Game.log frais → en jeu", () => expect(sessionState(10, null, now)).toEqual({ kind: "live" }));
  it("hors jeu depuis la dernière session", () =>
    expect(sessionState(null, "2026-10-18T15:10:00Z", now)).toEqual({ kind: "offline", sinceMinutes: 90 }));
  it("aucune session connue", () => expect(sessionState(null, null, now)).toEqual({ kind: "offline", sinceMinutes: null }));
});

describe("topItems", () => {
  it("somme par classe sur tous les inventaires, tri décroissant, n respecté", () => {
    const r = topItems({ MOI: { a: { qte: 3 }, b: { qte: 10 } }, "L:1": { a: { qte: 9 }, c: { qte: 1 } } }, 2);
    expect(r).toEqual([{ classe: "a", qte: 12 }, { classe: "b", qte: 10 }]);
  });
});

describe("blocs de l'accueil sans donnée (premier lancement, hors-ligne)", () => {
  it("firstLogin uniquement si le drapeau est vrai", () => {
    expect(isFirstLogin({ firstLogin: true })).toBe(true);
    expect(isFirstLogin({ firstLogin: false })).toBe(false);
    expect(isFirstLogin(null)).toBe(false);
    expect(isFirstLogin("x")).toBe(false);
  });
  it("carnet masqué sans session, dépense ni mission", () => {
    expect(hasLogbook(null)).toBe(false);
    expect(hasLogbook({ lastSession: null, spendingTotal: 0, missions: { completed: 0 }, blueprintsUnlocked: 0 })).toBe(false);
    expect(hasLogbook({ lastSession: null, spendingTotal: 0, missions: { completed: 2 }, blueprintsUnlocked: 0 })).toBe(true);
  });
  it("serveurs masqués sans composant (hors-ligne)", () => {
    expect(hasServers(null)).toBe(false);
    expect(hasServers({ overall: "unknown", overallLabel: "", components: [] })).toBe(false);
    expect(hasServers({ overall: "ok", overallLabel: "", components: [{ name: "PU", status: "operational" }] })).toBe(true);
  });
});

describe("sinceLabel", () => {
  it("minutes, heures puis jours", () => {
    expect(sinceLabel(42)).toEqual({ key: "home.offlineSince", n: 42 });
    expect(sinceLabel(180)).toEqual({ key: "home.offlineSinceH", n: 3 });
    expect(sinceLabel(14400)).toEqual({ key: "home.offlineSinceD", n: 10 });
  });
});

describe("bestRouteState (tuile meilleure route → planificateur)", () => {
  it("transmet vaisseau et identité de la route", () => {
    expect(bestRouteState({ shipName: "C2", routes: [{ commodity: "Gold", fromLocation: "A", toLocation: "B", profit: 9 }] }))
      .toEqual({ route: { shipName: "C2", commodity: "Gold", fromLocation: "A", toLocation: "B" } });
    expect(bestRouteState({ shipName: "C2", routes: [] })).toBeNull();
    expect(bestRouteState(null)).toBeNull();
  });
});

describe("cibles des actions d'alerte", () => {
  it("UEX périmé → section Données des réglages ; Game.log coupé → section Datamining", () => {
    const a = deriveAlerts({ ...base, uexAgeHours: 48, gamelogEnabled: false, gamelogPathExists: true });
    expect(a.find((x) => x.kind === "uexStale")?.to).toBe("/settings#donnees");
    expect(a.find((x) => x.kind === "gamelogOff")?.to).toBe("/settings#datamining");
  });
});
