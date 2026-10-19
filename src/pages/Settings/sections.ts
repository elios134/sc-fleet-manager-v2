// Sections de la page Paramètres (navigation + ancre de l'URL). Pur, testé.
export type SectionKey = "compte" | "apparence" | "donnees" | "jeu" | "notifs" | "apropos" | "diagnostic";

export const SECTIONS: { key: SectionKey; group: "moi" | "app"; labelKey: string; devOnly?: boolean }[] = [
  { key: "compte", group: "moi", labelKey: "settings.nav.compte" },
  { key: "apparence", group: "moi", labelKey: "settings.nav.apparence" },
  { key: "donnees", group: "app", labelKey: "settings.nav.donnees" },
  { key: "jeu", group: "app", labelKey: "settings.nav.jeu" },
  { key: "notifs", group: "app", labelKey: "settings.nav.notifs" },
  { key: "apropos", group: "app", labelKey: "settings.nav.apropos" },
  { key: "diagnostic", group: "app", labelKey: "settings.nav.diagnostic", devOnly: true },
];

// Ancres d'avant la refonte (liens de l'accueil) → section actuelle.
const LEGACY: Record<string, SectionKey> = { datamining: "jeu" };

/** Section ouverte d'après l'ancre (`#donnees`) ; inconnue ou réservée au dev → Compte. */
export function sectionFromHash(hash: string, dev: boolean): SectionKey {
  const h = hash.replace(/^#/, "");
  const key = LEGACY[h] ?? h;
  const s = SECTIONS.find((x) => x.key === key);
  return s && (!s.devOnly || dev) ? s.key : "compte";
}
