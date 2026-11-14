import { describe, it, expect } from "vitest";
import { availableRenders, findShipModel, hasVisitableInterior, indexShipsByName, newerIndex, pickVariant, type Ship3DShip } from "./ship3d";

describe("newerIndex", () => {
  const pub = { generatedAt: "2026-11-13T21:33:00Z", ships: [] };
  const dev = (generatedAt?: string) => ({ generatedAt, ships: [] });
  it("index local périmé : on garde le publié", () => expect(newerIndex(pub, dev("2026-10-24T13:00:42Z"))).toBe(pub));
  it("index local plus récent (essai non publié) : on le prend", () => {
    const d = dev("2026-11-14T10:00:00Z");
    expect(newerIndex(pub, d)).toBe(d);
  });
  it("un seul des deux disponible", () => {
    const d = dev("2026-10-24T13:00:42Z");
    expect(newerIndex(null, d)).toBe(d);
    expect(newerIndex(pub, null)).toBe(pub);
  });
  it("date absente côté local : on garde le publié", () => expect(newerIndex(pub, dev())).toBe(pub));
});

const ship = (key: string, name: string): Ship3DShip => ({ key, name, variants: [{ level: "exterior", modelUrl: `${key}.glb` }] });
const MODELS = indexShipsByName({
  ships: [
    ship("RSI_Constellation_Andromeda", "Constellation Andromeda"),
    ship("RSI_Constellation_Mk5_Centaurus", "Constellation Mk V Centaurus"),
    ship("RSI_Constellation_Phoenix_Emerald", "Constellation Phoenix Emerald"),
  ],
});

describe("findShipModel", () => {
  it("nom exact d'abord", () => {
    expect(findShipModel(MODELS, "Constellation Mk V Centaurus")?.key).toBe("RSI_Constellation_Mk5_Centaurus");
  });
  it("tolère la génération « Mk IV » absente de l'index (Constellation Mk IV Andromeda)", () => {
    expect(findShipModel(MODELS, "Constellation Mk IV Andromeda")?.key).toBe("RSI_Constellation_Andromeda");
    expect(findShipModel(MODELS, "Constellation Mk IV Phoenix Emerald")?.key).toBe("RSI_Constellation_Phoenix_Emerald");
  });
  it("pas de rapprochement abusif : variante absente de l'index → rien", () => {
    expect(findShipModel(MODELS, "Constellation Mk IV Taurus Wikelo War Special")).toBeUndefined();
  });
});

describe("pickVariant", () => {
  const v = (level: "exterior" | "interior", render?: "clay" | "painted" | "textured") => ({ level, modelUrl: `${level}-${render ?? "legacy"}.glb`, render });
  const ship = [v("exterior", "clay"), v("exterior", "painted"), v("interior", "clay"), v("interior", "painted"), v("interior", "textured")];
  it("peint demandé et disponible : peint, avec le clay affiché pendant le téléchargement", () => {
    expect(pickVariant(ship, "exterior", "painted")).toEqual({ main: ship[1], fallback: ship[0] });
    expect(pickVariant(ship, "interior", "painted")).toEqual({ main: ship[3], fallback: ship[2] });
  });
  it("clay demandé : clay seul", () => {
    expect(pickVariant(ship, "exterior", "clay")).toEqual({ main: ship[0], fallback: null });
  });
  it("rendu demandé absent : l'autre ; le texturé (essai abandonné) n'est jamais choisi", () => {
    expect(pickVariant([v("exterior", "clay")], "exterior", "painted")).toEqual({ main: v("exterior", "clay"), fallback: null });
    expect(pickVariant([v("interior", "textured")], "interior", "painted")).toEqual({ main: null, fallback: null });
    const legacy = v("exterior");
    expect(pickVariant([legacy], "exterior", "painted")).toEqual({ main: legacy, fallback: null }); // ancien index = clay
  });
  it("rendus disponibles d'un niveau, dans l'ordre de la bascule (texturé ignoré)", () => {
    expect(availableRenders(ship, "interior")).toEqual(["clay", "painted"]);
    expect(availableRenders([v("exterior", "clay"), v("exterior", "textured")], "exterior")).toEqual(["clay"]);
  });
});

describe("hasVisitableInterior", () => {
  const withInterior = (interiorKind: "habitable" | "cockpit"): Ship3DShip => ({
    key: "k",
    name: "n",
    variants: [{ level: "exterior", modelUrl: "e.glb" }, { level: "interior", modelUrl: "i.glb", interiorKind }],
  });
  it("vrai avec un intérieur complet, faux pour un simple cockpit, sans intérieur ou sans modèle", () => {
    expect(hasVisitableInterior(withInterior("habitable"))).toBe(true);
    expect(hasVisitableInterior(withInterior("cockpit"))).toBe(false);
    expect(hasVisitableInterior(ship("A", "A"))).toBe(false);
    expect(hasVisitableInterior(undefined)).toBe(false);
  });
});
