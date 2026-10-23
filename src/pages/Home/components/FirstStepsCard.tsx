import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";
import type { FirstStepKey } from "../../../lib/firstSteps";
import type { useFirstSteps } from "../useFirstSteps";

// Réglage ouvert par chaque étape sans synchro directe.
const SETTINGS: Record<FirstStepKey, string> = {
  account: "/settings#compte",
  wiki: "/settings#donnees",
  uex: "/settings#donnees",
  starmap: "/settings#donnees",
  gamelog: "/settings#jeu",
};

/** Carte « Premiers pas » : 5 étapes cochées toutes seules, chacune avec son action. */
export function FirstStepsCard({ fs, onOpen }: { fs: ReturnType<typeof useFirstSteps>; onOpen: (to: string) => void }) {
  const { t } = useTranslation();
  if (fs.allDone || fs.dismissed) return null;
  return (
    <section className="glass flex flex-col gap-2.5 rounded-2xl px-4 py-3.5" style={{ background: "rgba(20,20,32,0.5)" }} aria-label={t("home.firstSteps.title")}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/55">{t("home.firstSteps.title")}</h2>
        <span className="font-mono text-[11px] text-white/45">{fs.doneCount} / {fs.steps.length}</span>
        <button type="button" onClick={fs.dismiss} aria-label={t("home.firstSteps.dismiss")} title={t("home.firstSteps.dismiss")} className="rounded p-0.5 text-white/35 hover:bg-white/10 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${(fs.doneCount / fs.steps.length) * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-1.5">
        {fs.steps.map((s, i) => {
          const busy = fs.running === s.key;
          return (
            <li key={s.key} className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${s.key === fs.next ? "border-[var(--accent)]/45 bg-[var(--accent-muted)]" : "border-white/10 bg-white/[0.025]"}`}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${s.done ? "bg-emerald-400 text-emerald-950" : busy ? "bg-[var(--accent)] text-white" : "bg-white/[0.07] text-white/45"}`}>
                {s.done ? <Check className="h-3.5 w-3.5" /> : busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-white">{t(`home.firstSteps.${s.key}.title`)}</p>
                <p className="truncate text-[11px] text-white/45">{t(`home.firstSteps.${s.key}.desc`)}</p>
              </div>
              {!s.done && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fs.run(s.key) || onOpen(SETTINGS[s.key])}
                  className="shrink-0 rounded-[9px] border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[11.5px] font-bold text-white/85 hover:bg-white/15 disabled:opacity-60"
                >
                  {busy ? t("home.firstSteps.running") : t(`home.firstSteps.${s.key}.action`)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
