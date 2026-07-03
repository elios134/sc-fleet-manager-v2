// Rapport des clés i18n potentiellement inutilisées (lecture seule, ne modifie rien).
// Usage : node scripts/i18n-unused.mjs
//
// Détection : une clé est considérée UTILISÉE si son texte exact apparaît quelque part
// dans src/ (couvre t("k"), les clés stockées en littéral comme labelKey/descKey/maps),
// OU si elle commence par un préfixe de template dynamique `t(`x.${...}`)`. La détection
// penche volontairement vers « garder » (faux négatifs improbables). Concaténation de
// clés et traduction scopée (keyPrefix/getFixedT) NON gérées → à éviter dans le code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", "dist", ".git", "locales"].includes(f)) continue;
      walk(p, acc);
    } else if (/\.(tsx?|jsx?)$/.test(f)) acc.push(p);
  }
  return acc;
}

const src = walk(path.join(ROOT, "src"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

const prefixes = new Set();
for (const m of src.matchAll(/t\(\s*`([^`$]*)\$\{/g)) if (m[1]) prefixes.add(m[1]);

const used = (key) => src.includes(key) || [...prefixes].some((p) => key.startsWith(p));

const fr = JSON.parse(fs.readFileSync(path.join(ROOT, "src/i18n/locales/fr.json"), "utf8"));
const orphans = Object.keys(fr).filter((k) => !used(k));

console.log(`Clés définies : ${Object.keys(fr).length}`);
console.log(`Préfixes dynamiques détectés : ${[...prefixes].join(", ") || "(aucun)"}`);
console.log(`Clés potentiellement inutilisées : ${orphans.length}`);
for (const k of orphans) console.log("  " + k);
