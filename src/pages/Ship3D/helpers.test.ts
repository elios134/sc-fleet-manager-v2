import { describe, expect, it } from "vitest";
import type { Ship3DShip } from "../../lib/ship3d";
import { buildShipRows } from "./helpers";
import type { ShipRow } from "./types";

const model = (name: string, extra: Partial<Ship3DShip> = {}): Ship3DShip => ({
  name,
  manufacturer: "Drake Interplanetary",
  classification: "Combat",
  dims: { l: 10, b: 5, h: 3 },
  variants: [{ level: "exterior", modelUrl: "m.glb" }],
  ...extra,
});
const wiki = (id: number, name: string): ShipRow => ({
  id,
  name,
  manufacturer: "Drake",
  role: "Fighter",
  classification: "Light Fighter",
  length: 20,
  beam: 15,
  height: 5,
  crewMin: 1,
  crewMax: 2,
  cargoScu: 4,
  imageUrl: "img.png",
});

describe("buildShipRows", () => {
  it("une ligne par vaisseau de l'index, rien d'autre", () => {
    const rows = buildShipRows([model("Buccaneer")], [wiki(1, "Buccaneer"), wiki(2, "Golem Alliance"), wiki(3, "600i Executive Edition")]);
    expect(rows.map((r) => r.name)).toEqual(["Buccaneer"]);
  });

  it("fiche du wiki rattachée par nom (specs du wiki, nom de l'index)", () => {
    const [r] = buildShipRows([model("Constellation Andromeda")], [wiki(7, "Constellation Mk IV Andromeda")]);
    expect(r).toMatchObject({ id: 7, name: "Constellation Andromeda", crewMax: 2, cargoScu: 4, imageUrl: "img.png" });
  });

  it("sans fiche du wiki : constructeur, classe et dimensions de l'index", () => {
    const [r] = buildShipRows([model("Marauder")], []);
    expect(r).toMatchObject({ name: "Marauder", manufacturer: "Drake Interplanetary", classification: "Combat", length: 10, beam: 5, height: 3, crewMax: null, imageUrl: null });
    expect(r.id).toBeLessThan(0);
  });

  it("préfère la fiche au nom exact quand plusieurs correspondent", () => {
    const [r] = buildShipRows([model("Constellation Andromeda")], [wiki(7, "Constellation Mk IV Andromeda"), wiki(8, "Constellation Andromeda")]);
    expect(r.id).toBe(8);
  });

  it("une fiche du wiki ne sert qu'une fois (ids uniques)", () => {
    const rows = buildShipRows([model("Andromeda", { key: "A" }), model("Andromeda Mk IV", { key: "B" })], [wiki(7, "Andromeda")]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});
