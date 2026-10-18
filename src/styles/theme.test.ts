import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
