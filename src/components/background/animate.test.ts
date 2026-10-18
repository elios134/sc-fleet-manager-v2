import { describe, it, expect } from "vitest";
import { shouldAnimate, isGameActive } from "./animate";

const base = { hidden: false, reducedMotion: false, enabled: true, logAgeSecs: null as number | null };

describe("shouldAnimate", () => {
  it("anime par défaut", () => expect(shouldAnimate(base)).toBe(true));
  it("fenêtre cachée → pause", () => expect(shouldAnimate({ ...base, hidden: true })).toBe(false));
  it("réduire les animations → image fixe", () => expect(shouldAnimate({ ...base, reducedMotion: true })).toBe(false));
  it("réglage coupé → image fixe", () => expect(shouldAnimate({ ...base, enabled: false })).toBe(false));
  it("jeu en cours (Game.log frais) → pause", () => expect(shouldAnimate({ ...base, logAgeSecs: 12 })).toBe(false));
  it("Game.log ancien → anime", () => expect(shouldAnimate({ ...base, logAgeSecs: 600 })).toBe(true));
});

describe("isGameActive", () => {
  it("seuil 60 s", () => {
    expect(isGameActive(59)).toBe(true);
    expect(isGameActive(60)).toBe(false);
    expect(isGameActive(null)).toBe(false);
  });
});
