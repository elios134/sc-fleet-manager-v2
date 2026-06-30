import { describe, it, expect } from "vitest";
import { packBay, layoutBays, type Bay } from "./cargoBays";

const bay = (o: Partial<Bay>): Bay => ({
  cols: 4,
  rows: 4,
  layers: 2,
  scu: 32,
  maxScuBox: 32,
  open: true,
  external: false,
  ...o,
});

describe("packBay", () => {
  it("ne dépasse jamais les limites de la baie", () => {
    const b = bay({ cols: 5, rows: 4, layers: 3, scu: 60, maxScuBox: 32 });
    for (const c of packBay(b, 0)) {
      expect(c.x + c.w).toBeLessThanOrEqual(b.cols);
      expect(c.y + c.h).toBeLessThanOrEqual(b.layers);
      expect(c.z + c.d).toBeLessThanOrEqual(b.rows);
    }
  });

  it("aucun chevauchement de conteneurs", () => {
    const b = bay({ cols: 5, rows: 4, layers: 3, scu: 60, maxScuBox: 32 });
    const cells = new Set<string>();
    for (const c of packBay(b, 0)) {
      for (let i = c.x; i < c.x + c.w; i++)
        for (let j = c.y; j < c.y + c.h; j++)
          for (let k = c.z; k < c.z + c.d; k++) {
            const key = `${i},${j},${k}`;
            expect(cells.has(key)).toBe(false);
            cells.add(key);
          }
    }
  });

  it("ne place jamais de conteneur plus gros que maxScuBox", () => {
    const b = bay({ cols: 5, rows: 2, layers: 2, scu: 20, maxScuBox: 16 });
    for (const c of packBay(b, 0)) expect(c.sizeScu).toBeLessThanOrEqual(16);
  });

  it("remplit exactement une baie pleine alignée", () => {
    // 4×4×2 = 32 cellules, max 32 → un seul conteneur 32 (4×4×2) remplit tout.
    const placed = packBay(bay({ cols: 4, rows: 4, layers: 2, scu: 32, maxScuBox: 32 }), 0);
    const used = placed.reduce((a, c) => a + c.sizeScu, 0);
    expect(used).toBe(32);
    expect(placed.length).toBe(1);
  });

  it("le volume occupé ne dépasse pas la capacité de la baie", () => {
    const b = bay({ cols: 5, rows: 4, layers: 3, scu: 60, maxScuBox: 32 });
    const used = packBay(b, 0).reduce((a, c) => a + c.sizeScu, 0);
    expect(used).toBeLessThanOrEqual(b.scu);
  });
});

describe("layoutBays", () => {
  it("décale les baies (origines distinctes) et place tous les conteneurs", () => {
    const bays = [
      bay({ cols: 5, rows: 4, layers: 3, scu: 60, maxScuBox: 32 }),
      bay({ cols: 5, rows: 2, layers: 2, scu: 20, maxScuBox: 16 }),
    ];
    const { frames, containers } = layoutBays(bays);
    expect(frames.length).toBe(2);
    const origins = new Set(frames.map((f) => `${f.ox},${f.oz}`));
    expect(origins.size).toBe(2);
    expect(containers.length).toBeGreaterThan(0);
    // ids uniques
    expect(new Set(containers.map((c) => c.id)).size).toBe(containers.length);
  });

  it("conserve l'index d'origine des baies", () => {
    const bays = [bay({ scu: 8, maxScuBox: 8 }), bay({ scu: 60, cols: 5, rows: 4, layers: 3 })];
    const { frames } = layoutBays(bays);
    expect(new Set(frames.map((f) => f.index))).toEqual(new Set([0, 1]));
  });
});
