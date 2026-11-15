import { useTranslation } from "react-i18next";
import type { CacheFolder } from "./cache";

/** Libellé lisible d'un dossier de cache (« Shaders 4.10.2 », « Rapports de plantage »). */
export function useFolderLabel() {
  const { t } = useTranslation();
  return (f: CacheFolder) =>
    f.kind === "crashes" ? t("gameCache.crashes") : f.version ? t("gameCache.shaders", { version: f.version }) : f.name;
}
