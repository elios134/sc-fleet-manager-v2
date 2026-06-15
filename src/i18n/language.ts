import { invoke } from "@tauri-apps/api/core";
import i18n, { LANG_META_KEY, SUPPORTED_LANGS, type Lang } from "./index";

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (SUPPORTED_LANGS as readonly string[]).includes(v);
}

/** Lit la langue persistée (AppMeta settings.language) et l'applique à i18next.
 *  Silencieux si la BDD n'est pas prête ou si aucune valeur → langue par défaut. */
export async function bootstrapLanguage(): Promise<void> {
  try {
    const stored = await invoke<string | null>("get_app_meta", { key: LANG_META_KEY });
    if (isLang(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    /* BDD pas prête / pas de valeur : on garde la langue par défaut */
  }
}

/** Change la langue (i18next, application immédiate) et la persiste en AppMeta. */
export async function setLanguage(lang: Lang): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    await invoke("set_app_meta", { key: LANG_META_KEY, value: lang });
  } catch {
    /* persistance best-effort : la langue est déjà appliquée à l'écran */
  }
}
