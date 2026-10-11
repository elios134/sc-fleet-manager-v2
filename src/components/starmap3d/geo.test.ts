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
});
