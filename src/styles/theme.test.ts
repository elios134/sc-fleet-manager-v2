import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("theme.css", () => {
  it(".glass vit dans @layer components (sinon il écrase les utilitaires Tailwind border/bg/shadow)", () => {
    const css = readFileSync(join(__dirname, "theme.css"), "utf8");
    const layer = css.indexOf("@layer components");
    expect(layer).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(".glass {")).toBeGreaterThan(layer);
    expect(css.indexOf(".glass-hero")).toBeGreaterThan(layer);
  });
});

describe("couleurs des composants", () => {
  it("aucune classe Tailwind à couleur hexadécimale (« text-[#…] ») : passer par un jeton de theme.css", () => {
    const root = join(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
      });
    const hits = walk(root).flatMap((p) =>
      [...readFileSync(p, "utf8").matchAll(/-\[#[0-9a-fA-F]{3,8}\]/g)].map((m) => `${p.slice(root.length + 1)} ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });
});
