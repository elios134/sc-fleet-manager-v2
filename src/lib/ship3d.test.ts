import { describe, it, expect } from "vitest";
import { availableRenders, findShipModel, indexShipsByName, pickVariant, type Ship3DShip } from "./ship3d";

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
