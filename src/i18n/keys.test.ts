import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error module .mjs sans types (script Node partagé avec scripts/i18n-unused.mjs)
import { isKeyUsed } from "../../scripts/i18n-usage.lib.mjs";

const fr: Record<string, string> = JSON.parse(readFileSync(join(__dirname, "locales/fr.json"), "utf8"));
const en: Record<string, string> = JSON.parse(readFileSync(join(__dirname, "locales/en.json"), "utf8"));

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(readFileSync(p, "utf8"));
  }
  return acc;
}
const code = sources(join(__dirname, "..")).join("\n");

describe("clés i18n utilisées avec un compteur", () => {
  it("chaque t(\"clé\", { count }) a ses formes _one et _other en fr et en", () => {
    const missing: string[] = [];
    for (const m of code.matchAll(/\bt\(\s*["']([\w.\-]+)["']\s*,\s*\{[^}]*\bcount\b/g)) {
      const k = m[1];
      for (const [lang, dict] of [["fr", fr], ["en", en]] as const) {
        if (!(k in dict) && !(`${k}_one` in dict && `${k}_other` in dict)) missing.push(`${lang}:${k}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("clés i18n littérales", () => {
  it("chaque t(\"clé\") existe en fr et en (clé ou formes plurielles)", () => {
    const missing: string[] = [];
    for (const m of code.matchAll(/\bt\(\s*["']([a-zA-Z][\w\-]*(?:\.[\w\-]+)+)["']/g)) {
      const k = m[1];
      for (const [lang, dict] of [["fr", fr], ["en", en]] as const) {
        if (!(k in dict) && !(`${k}_one` in dict)) missing.push(`${lang}:${k}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("script de nettoyage (scripts/i18n-usage.lib.mjs)", () => {
  it("une forme plurielle compte comme utilisée si sa clé de base l'est", () => {
    const src = 't("fleet.shipsCount", { count: n })';
    expect(isKeyUsed("fleet.shipsCount_one", src, [])).toBe(true);
    expect(isKeyUsed("fleet.shipsCount_other", src, [])).toBe(true);
    expect(isKeyUsed("fleet.other_one", src, [])).toBe(false);
    expect(isKeyUsed("home.alertAction.uexStale", "", ["home.alertAction."])).toBe(true);
  });
});
