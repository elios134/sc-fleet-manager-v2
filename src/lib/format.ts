// Formatage de nombres partagé (évite les copies locales de fmtAUEC/fmtPow).

/** Montant aUEC abrégé : 1 234 567 → "1.23 M", 12 000 → "12 k", 1 500 → "1.5 k". */
export function fmtAUEC(n: number): string {
  const v = Math.round(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " M";
  if (v >= 1e4) return Math.round(v / 1e3) + " k";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " k";
  return "" + v;
}

/** Entier formaté avec séparateurs (locale fr par défaut), ex. 3600 → "3 600". */
export function fmtNum(n: number, locale = "fr-FR"): string {
  return Math.round(n || 0).toLocaleString(locale);
}

/** Alias sémantique pour les puissances/débits (minage). */
export const fmtPow = fmtNum;
