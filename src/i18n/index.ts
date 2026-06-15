import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import fr from "./locales/fr.json";
import en from "./locales/en.json";

export const SUPPORTED_LANGS = ["fr", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

// Clé AppMeta de persistance du choix de langue (parité V1 'settings.language').
export const LANG_META_KEY = "settings.language";
export const DEFAULT_LANG: Lang = "fr";

// Init i18next + react-i18next. Clés PLATES (style 'nav.dashboard') → keySeparator
// et nsSeparator désactivés pour réutiliser tel quel le jeu de clés de la V1.
// La langue par défaut est 'fr' ; elle est remplacée au boot depuis AppMeta.
void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: DEFAULT_LANG,
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGS,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React échappe déjà le rendu
  returnNull: false,
});

export default i18n;
