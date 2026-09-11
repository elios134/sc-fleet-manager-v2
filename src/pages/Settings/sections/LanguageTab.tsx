import { useTranslation } from "react-i18next";
import { setLanguage } from "../../../i18n/language";
import { SUPPORTED_LANGS } from "../../../i18n";

function LanguageTab() {
  const { t, i18n } = useTranslation();
  const current = i18n.language;
  const LABELS: Record<string, string> = {
    fr: t("settings.langue.optionFr"),
    en: t("settings.langue.optionEn"),
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {SUPPORTED_LANGS.map((lng) => {
          const active = current === lng;
          return (
            <button
              key={lng}
              type="button"
              onClick={() => void setLanguage(lng)}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-muted)] text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
              ].join(" ")}
            >
              {LABELS[lng] ?? lng}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Onglet Comptes ─────────────────────────── */

export { LanguageTab };
