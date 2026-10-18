// Détection d'usage d'une clé i18n (partagée par scripts/i18n-unused.mjs et son test).
// Une clé est UTILISÉE si son texte exact apparaît dans le code, ou si elle commence par un
// préfixe de template dynamique `t(`x.${...}`)`. Une forme plurielle i18next (`k_one`,
// `k_other`…) est utilisée quand sa clé de base `k` l'est (t("k", { count })).
const PLURAL = /_(zero|one|two|few|many|other)$/;

export function isKeyUsed(key, src, prefixes) {
  const base = key.replace(PLURAL, "");
  return [key, base].some((k) => src.includes(k) || prefixes.some((p) => k.startsWith(p)));
}
