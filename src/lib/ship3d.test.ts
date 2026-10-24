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
  const both = [v("exterior", "clay"), v("exterior", "textured"), v("interior", "clay"), v("interior", "textured")];
  it("texturé demandé et disponible : texturé, avec le clay affiché pendant le téléchargement", () => {
    expect(pickVariant(both, "exterior", "textured")).toEqual({ main: both[1], fallback: both[0] });
    expect(pickVariant(both, "interior", "textured")).toEqual({ main: both[3], fallback: both[2] });
  });
  it("clay demandé : clay seul", () => {
    expect(pickVariant(both, "exterior", "clay")).toEqual({ main: both[0], fallback: null });
  });
  it("rendu demandé absent : l'autre (ancien index sans `render` = texturé)", () => {
    expect(pickVariant([v("exterior", "clay")], "exterior", "textured")).toEqual({ main: v("exterior", "clay"), fallback: null });
    const legacy = v("exterior");
    expect(pickVariant([legacy], "exterior", "clay")).toEqual({ main: legacy, fallback: null });
    expect(pickVariant([], "interior", "textured")).toEqual({ main: null, fallback: null });
  });
});

describe("rendu peint", () => {
  const v = (level: "exterior" | "interior", render?: "clay" | "painted" | "textured") => ({ level, modelUrl: `${level}-${render}.glb`, render });
  const capital = [v("exterior", "clay"), v("exterior", "painted"), v("interior", "clay"), v("interior", "painted")];
  it("peint demandé : peint, avec le clay en attendant ; texturé demandé mais absent : peint", () => {
    expect(pickVariant(capital, "interior", "painted")).toEqual({ main: capital[3], fallback: capital[2] });
    expect(pickVariant(capital, "interior", "textured")).toEqual({ main: capital[3], fallback: capital[2] });
  });
  it("rendus disponibles d'un niveau, dans l'ordre de la bascule", () => {
    expect(availableRenders([...capital, v("interior", "textured")], "interior")).toEqual(["clay", "painted", "textured"]);
    expect(availableRenders([v("exterior", "clay")], "exterior")).toEqual(["clay"]);
  });
});

