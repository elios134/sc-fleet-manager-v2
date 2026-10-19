import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, X } from "lucide-react";
import { appLocale } from "../lib/format";
import { parseReleaseNotes } from "../lib/releaseNotes";

/** Fenêtre « Quoi de neuf » : notes d'une version (texte de la release GitHub mis en forme).
 *  Utilisée au premier lancement après une mise à jour, depuis le toast « mise à jour
 *  disponible » et depuis l'historique de Paramètres › À propos. */
export function WhatsNewModal({
  version,
  from,
  date,
  body,
  eyebrow,
  primaryLabel,
  onPrimary,
  onClose,
}: {
  version: string;
  /** Version précédente (« v3.1.1 → v3.2.0 ») ; absente pour une version consultée. */
  from?: string | null;
  date?: string | null;
  body: string;
  eyebrow: string;
  primaryLabel: string;
  onPrimary: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sections = useMemo(() => parseReleaseNotes(body), [body]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const day = date ? new Date(date).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" }) : null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]" style={{ zIndex: 400 }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("whatsNew.title")}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(640px,calc(100vh-40px))] w-[min(560px,100%)] flex-col overflow-hidden rounded-[20px] border border-[var(--accent)]/35 bg-[linear-gradient(160deg,rgba(99,102,241,0.22),rgba(20,20,32,0.92)_45%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      >
        <header className="flex items-start gap-3 px-[22px] pb-3.5 pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/40">{eyebrow}</p>
            <h2 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight text-white">{t("whatsNew.title")}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[12px] font-bold text-white/60">
              {from && <span className="text-white/35 line-through">v{from}</span>}
              {from && <span>→</span>}
              <span className="rounded-md bg-[var(--accent)] px-1.5 text-white">v{version}</span>
              {day && <span className="font-sans font-semibold">· {day}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("whatsNew.close")} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-2 [scrollbar-width:thin]">
          {sections.length === 0 && <p className="py-3 text-[13px] text-white/50">{t("whatsNew.empty")}</p>}
          {sections.map((s, i) => {
            const fix = /correct|fix|bug/i.test(s.title);
            return (
              <section key={`${s.title}-${i}`} className="pb-1">
                {s.title && (
                  <h3 className="mb-1.5 mt-3.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/55">
                    {s.title}
                    <span className="h-px flex-1 bg-white/10" />
                  </h3>
                )}
                {s.items.map((it, j) => (
                  <div key={j} className="flex gap-2.5 py-1.5">
                    <span
                      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] ${
                        fix ? "bg-emerald-400/15 text-emerald-300" : "bg-[var(--accent-muted)] text-indigo-200"
                      }`}
                    >
                      {fix ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <b className="block text-[13.5px] text-white">{it.title}</b>
                      {it.text && <span className="text-[12.5px] text-white/60">{it.text}</span>}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
        <footer className="flex items-center gap-2 border-t border-white/10 px-[22px] pb-[18px] pt-3.5">
          <button type="button" onClick={onPrimary} className="ml-auto rounded-[11px] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-semibold text-white">
            {primaryLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
