// Actualités RSI (logique pure, testée) : date d'un article, couleur d'un statut de serveur.

const RELATIVE = /^(\d+) (second|minute|hour|day|week|month|year)s? ago$/;

/** Date d'un article : la date relative de RSI (« 2 days ago ») traduite, une date ISO mise en
 *  forme, tout autre texte gardé tel quel ; vide si absente. */
export function fmtNewsDate(value: string | null, locale: string): string {
  if (!value) return "";
  const rel = RELATIVE.exec(value);
  if (rel) return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-Number(rel[1]), rel[2] as Intl.RelativeTimeFormatUnit);
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/** Couleur du thème pour un code de statut (cf. rsi_status.rs). */
export function statusColor(status: string): string {
  switch (status) {
    case "operational":
      return "var(--success)";
    case "degraded":
    case "partial":
      return "var(--amber)";
    case "major":
      return "var(--danger)";
    case "maintenance":
      return "var(--info)";
    default:
      return "var(--muted)";
  }
}
