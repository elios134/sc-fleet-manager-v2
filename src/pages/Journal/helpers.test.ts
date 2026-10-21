import { describe, it, expect } from "vitest";
import { buildHeatmap, fmtCompact, fmtDuration, fmtHours, fmtSessionDate, prettyVehicle } from "./helpers";

describe("formatage du Carnet de bord", () => {
  it("heures et durées", () => {
    expect(fmtHours(3 * 3600 + 1200)).toBe("3 h");
    expect(fmtHours(45 * 60)).toBe("45 min");
    expect(fmtDuration(2 * 3600 + 14 * 60)).toBe("2 h 14");
    expect(fmtDuration(5 * 60)).toBe("5 min");
  });
  it("montants compacts (aUEC)", () => {
    expect(fmtCompact(null)).toBe("—");
    expect(fmtCompact(340)).toBe("340");
    expect(fmtCompact(890_400)).toBe("890 k");
    expect(fmtCompact(1_240_000)).toBe("1,24 M");
  });
  it("dates de session : vide ou invalide → tiret", () => {
    expect(fmtSessionDate(null)).toBe("—");
    expect(fmtSessionDate("pas une date")).toBe("—");
    expect(fmtSessionDate(new Date().toISOString())).toMatch(/^aujourd'hui \d{2}:\d{2}$/);
  });
  it("code véhicule lisible", () => {
    expect(prettyVehicle("ORIG_m80")).toBe("ORIG m80");
  });
});

describe("buildHeatmap", () => {
  it("grille semaines × 7 jours, niveaux par heures jouées, pic du jour le plus long", () => {
    const today = new Date().toISOString().slice(0, 10);
    const { cells, monthLabels, peak } = buildHeatmap([{ date: today, seconds: 4 * 3600 }], 4);
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.length === 7)).toBe(true);
    expect(monthLabels).toHaveLength(4);
    const all = cells.flat();
    const hit = all.find((c) => c.date === today);
    expect(hit?.level).toBe(3);
    expect(peak?.date).toBe(today);
  });
  it("aucune activité → pas de pic, tout au niveau 0", () => {
    const { cells, peak } = buildHeatmap([], 2);
    expect(peak).toBeNull();
    expect(cells.flat().every((c) => c.level === 0)).toBe(true);
  });
});
