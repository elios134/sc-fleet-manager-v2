import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, buildGeo } from "./starmap-geo.lib.mjs";

test("parseCsv gère les en-têtes et le nombre de colonnes", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  assert.deepEqual(rows, [{ a: "1", b: "2", c: "3" }, { a: "4", b: "5", c: "6" }]);
});

test("buildGeo normalise corps + POI et ignore les lignes incomplètes", () => {
  const bodiesCsv =
    "name,type,parentBody,parentStar,coordinateX,coordinateY,coordinateZ,bodyRadius,rotationCorrection,orbitAngle,orbitRadius,themeColorR,themeColorG,themeColorB\n" +
    "microTech,Planet,,Stanton,1,2,3,1000,12.5,0,100,120,160,190\n" +
    "BrokenRow,Planet,,Stanton,,,,,,,,,,\n";
  const locationsCsv =
    "name,type,parentBody,parentStar,coordinateX,coordinateY,coordinateZ,wikiLink,private,quantum\n" +
    "New Babbage,LandingZone,microTech,Stanton,10,20,30,https://x,0,0\n";
  const g = buildGeo({ bodiesCsv, locationsCsv, systemsCsv: "name,star\nStanton,Stanton\n" });
  assert.equal(g.bodies.length, 1);
  assert.equal(g.bodies[0].name, "microTech");
  assert.deepEqual(g.bodies[0].themeColor, [120, 160, 190]);
  assert.equal(g.pois.length, 1);
  assert.equal(g.pois[0].parentBody, "microTech");
});
