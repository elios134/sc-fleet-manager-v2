import { describe, it, expect } from "vitest";
import { layoutSystem } from "./layout";
import type { StarmapBodyItem } from "./starmapData";

const b = (id: string, navIcon: string, parent: string | null, distance: number | null = null, longitude: number | null = null): StarmapBodyItem => ({
  id, recordName: id, systemName: "stanton", navIcon, name: id, description: null, size: 1000, parentRef: parent,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance,
  longitude, latitude: null, subtype: null, affColor: null,
});

describe("layoutSystem — stations", () => {
  const bodies = [
    b("star", "Star", null),
    b("hur", "Planet", "star", 0.86, -30),
    b("cru", "Planet", "star", 1.28, -160),
    b("yela", "Moon", "cru"),
    b("l4", "Station", "star", 0.86, 30), // Lagrange : même orbite que Hurston
    b("grim", "Station", "yela"),
  ];
  const placed = layoutSystem(bodies, "stanton");
  const at = (id: string) => placed.find((p) => p.body.id === id);

  it("station de l'étoile placée sur l'orbite (distance, longitude) comme une planète", () => {
    const l4 = at("l4")!;
    const hur = at("hur")!;
    expect(l4.kind).toBe("station");
    expect(Math.hypot(...l4.pos)).toBeCloseTo(Math.hypot(...hur.pos), 5);
  });

  it("station d'une lune placée près de cette lune", () => {
    const grim = at("grim")!;
    const yela = at("yela")!;
    const d = Math.hypot(grim.pos[0] - yela.pos[0], grim.pos[1] - yela.pos[1], grim.pos[2] - yela.pos[2]);
    expect(grim.kind).toBe("station");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(yela.radius * 4);
  });
});
