import { describe, expect, it } from "vitest";
import { describeItem, durationParts } from "./timeline";

describe("describeItem", () => {
  it("mission terminée : titre, réputation et plans", () => {
    const d = describeItem({ kind: "ended", at: "", outcome: "completed", title: "Neutralisez la menace", rep: [{ faction: "InterSec Defense Solutions", amount: 300 }], loot: ["Brassards", "Jambières"] });
    expect(d).toEqual({ tone: "success", titleKey: "resume.ev.completed", title: "Neutralisez la menace", rep: [{ faction: "InterSec Defense Solutions", amount: 300 }], loot: 2 });
  });
  it("mission échouée ou abandonnée", () => {
    expect(describeItem({ kind: "ended", at: "", outcome: "failed", title: null, rep: [], loot: [] }).tone).toBe("danger");
    expect(describeItem({ kind: "ended", at: "", outcome: "abandoned", title: null, rep: [], loot: [] }).titleKey).toBe("resume.ev.abandoned");
  });
  it("vaisseau, saut quantique groupé, mort, connexion", () => {
    expect(describeItem({ kind: "vehicle", at: "", vehicle: "RSI_Perseus" })).toMatchObject({ tone: "warning", title: "RSI Perseus" });
    expect(describeItem({ kind: "quantum", at: "", count: 3, destination: "Stanton2" })).toMatchObject({ tone: "info", titleKey: "resume.ev.quantum", count: 3 });
    expect(describeItem({ kind: "death", at: "", zone: "Orison", killer: "x", victim: "y" })).toMatchObject({ tone: "danger", title: "Orison" });
    expect(describeItem({ kind: "login", at: "", character: "elios5" })).toMatchObject({ tone: "mute", title: "elios5" });
  });
});

describe("durationParts", () => {
  it("heures et minutes", () => {
    expect(durationParts(4380)).toEqual({ h: 1, m: 13 });
    expect(durationParts(59)).toEqual({ h: 0, m: 0 });
  });
});
