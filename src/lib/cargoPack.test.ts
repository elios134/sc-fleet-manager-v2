import { describe, it, expect } from "vitest";
import { containerDim, packCells, CONTAINER_DIM } from "./cargoPack";

describe("containerDim", () => {
  it("tailles connues = volume ≈ SCU", () => {
    for (const [scu, [w, d, h]] of Object.entries(CONTAINER_DIM)) {
      expect(w * d * h).toBe(Number(scu));
    }
  });
  it("taille inconnue → repli ~cubique non nul", () => {
    const [w, d, h] = containerDim(40);
    expect(w).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe("packCells", () => {
  const cells = [
    { id: 1, sizeScu: 32 },
    { id: 2, sizeScu: 32 },
    { id: 3, sizeScu: 2 },
    { id: 4, sizeScu: 1 },
  ];

  it("place toutes les boîtes, coordonnées ≥ 0", () => {
    const placed = packCells(cells);
    expect(placed.length).toBe(cells.length);
    for (const p of placed) {
      expect(p.gx).toBeGreaterThanOrEqual(0);
      expect(p.gz).toBeGreaterThanOrEqual(0);
      expect(p.w * p.d * p.h).toBe(p.cell.sizeScu);
    }
  });

  it("ne fait pas déborder la largeur cible (wrap en bandes)", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i, sizeScu: 4 }));
    const placed = packCells(many);
    // plusieurs rangées (gz distincts) → le wrap a eu lieu
    const rows = new Set(placed.map((p) => p.gz));
    expect(rows.size).toBeGreaterThan(1);
  });
});
