import { describe, it, expect } from "vitest";
import { parseGeo } from "./starmapData";

describe("parseGeo", () => {
  it("garde les corps valides, ignore les invalides, ne jette jamais", () => {
    const g = parseGeo({
      systems: [{ name: "Stanton", star: "Stanton" }],
      bodies: [
        {
          name: "microTech", type: "Planet", parentBody: null, parentStar: "Stanton",
          coord: [1, 2, 3], bodyRadius: 1000, rotationCorrection: 12,
          orbitRadius: 100, orbitAngle: 0, themeColor: [1, 2, 3],
        },
        { name: "", bodyRadius: 10 }, // invalide → ignoré
      ],
      pois: [{ name: "NB", type: "LZ", parentBody: "microTech", coord: [1, 1, 1], wikiLink: null }],
    });
    expect(g.bodies).toHaveLength(1);
    expect(g.pois).toHaveLength(1);
  });
  it("entrée null/garbage → structure vide", () => {
    expect(parseGeo(null)).toEqual({ systems: [], bodies: [], pois: [] });
    expect(parseGeo({ bodies: "x" })).toEqual({ systems: [], bodies: [], pois: [] });
  });
  it("POI : marqueurs quantum / privé lus, faux par défaut (ancien JSON)", () => {
    const g = parseGeo({
      pois: [
        { name: "A", type: "CommArray", parentBody: "Cellin", coord: [1, 1, 1], quantum: true, hidden: true },
        { name: "B", type: "Ruins", parentBody: "Cellin", coord: [1, 1, 1] },
      ],
    });
    expect([g.pois[0].quantum, g.pois[0].hidden]).toEqual([true, true]);
    expect([g.pois[1].quantum, g.pois[1].hidden]).toEqual([false, false]);
  });
});
