// Conversion one-shot des dictionnaires i18n maison de la V1 (TS clé→valeur) vers
// des fichiers JSON i18next pour la V2. Conserve les MÊMES clés (réutilisation directe
// dans les lots de migration). Convertit l'interpolation `{var}` (format V1 simple
// accolade) vers `{{var}}` (i18next) SANS toucher aux `{{var}}` déjà présents.
//
// Usage : node scripts/convert-i18n.mjs
// Source V1 (chemin absolu, hors repo V2) :
const V1_DIR =
  "C:/Users/andre/Documents/electron/SC fleetManager/sc-fleet-manager/src/renderer/i18n";
// Destination V2 :
const OUT_DIR = new URL("../src/i18n/locales/", import.meta.url);

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Charge un dict V1 (fr.ts / en.ts) en objet JS plat { 'clé': 'valeur' }. */
function loadDict(file) {
  let src = readFileSync(`${V1_DIR}/${file}`, "utf8");
  // 1. retire les lignes d'import
  src = src.replace(/^\s*import\b.*$/gm, "");
  // 2. coupe tout ce qui suit l'objet (export type TranslationDict / TranslationKey…)
  const typeIdx = src.indexOf("export type");
  if (typeIdx !== -1) src = src.slice(0, typeIdx);
  // 2b. neutralise le `} as const` terminal (en.ts) — assertion TS non valide en JS
  src = src.replace(/}\s*as\s+const/g, "}");
  // 3. transforme `export const xx[: Type] = {` en `return {`
  src = src.replace(/export\s+const\s+\w+\s*(:\s*[\w<>, ]+)?\s*=\s*/, "return ");
  // 4. évalue l'objet littéral (les commentaires // et virgules finales sont tolérés)
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

// Convertit {var} → {{var}} sans doubler les {{var}} existants (lookbehind/lookahead).
const SINGLE_BRACE = /(?<!\{)\{(\w+)\}(?!\})/g;

function convertValue(val, key, ambiguities) {
  let count = 0;
  const out = val.replace(SINGLE_BRACE, (_, name) => {
    count++;
    return `{{${name}}}`;
  });
  // Détection d'ambiguïté : accolade simple restante non convertie (ni {{ ni }})
  const leftover = out.replace(/\{\{[^}]*\}\}/g, "");
  if (/[{}]/.test(leftover)) {
    ambiguities.push({ key, value: val });
  }
  return { out, count };
}

const langs = [
  { file: "fr.ts", code: "fr" },
  { file: "en.ts", code: "en" },
];

mkdirSync(fileURLToPath(OUT_DIR), { recursive: true });

const keysets = {};
let totalConversions = 0;
const allAmbiguities = [];

for (const { file, code } of langs) {
  const dict = loadDict(file);
  const out = {};
  let conv = 0;
  for (const [key, val] of Object.entries(dict)) {
    if (typeof val !== "string") {
      allAmbiguities.push({ key, value: `(non-string: ${typeof val})` });
      out[key] = val;
      continue;
    }
    const { out: converted, count } = convertValue(val, key, allAmbiguities);
    out[key] = converted;
    conv += count;
  }
  totalConversions += conv;
  keysets[code] = Object.keys(out);
  const dest = fileURLToPath(new URL(`${code}.json`, OUT_DIR));
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`✔ ${code}.json — ${keysets[code].length} clés, ${conv} interpolations {var}→{{var}}`);
}

// Vérif : même jeu de clés fr/en
const frSet = new Set(keysets.fr);
const enSet = new Set(keysets.en);
const onlyFr = keysets.fr.filter((k) => !enSet.has(k));
const onlyEn = keysets.en.filter((k) => !frSet.has(k));

console.log(`\nTotal interpolations converties : ${totalConversions}`);
console.log(`Clés fr=${keysets.fr.length}  en=${keysets.en.length}`);
if (onlyFr.length || onlyEn.length) {
  console.log(`⚠ ÉCART de clés — uniquement fr (${onlyFr.length}):`, onlyFr.slice(0, 20));
  console.log(`⚠ ÉCART de clés — uniquement en (${onlyEn.length}):`, onlyEn.slice(0, 20));
} else {
  console.log("✔ fr et en ont EXACTEMENT le même jeu de clés.");
}

if (allAmbiguities.length) {
  console.log(`\n⚠ ${allAmbiguities.length} valeur(s) ambiguë(s) (accolade non convertie — à vérifier) :`);
  for (const a of allAmbiguities.slice(0, 40)) console.log(`   [${a.key}] ${a.value}`);
} else {
  console.log("\n✔ Aucune accolade ambiguë restante.");
}
