import { Check } from "lucide-react";

/** Barre des 4 étapes du parcours (Extraire, Raffiner, Vendre, Fabriquer) : étape courante en
 *  accent, étapes passées cochées, étapes fermées grisées avec leur explication au survol. */
export function StepBar({
  current,
  enabled,
  onStep,
  t,
}: {
  current: number;
  enabled: boolean[];
  onStep: (i: number) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
      {enabled.map((open, i) => {
        const on = i === current;
        const done = i < current;
        return (
          <button
            key={i}
            type="button"
            disabled={!open}
            onClick={() => onStep(i)}
            aria-current={on ? "step" : undefined}
            title={open ? undefined : t("mining.stepLocked")}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? "border-[var(--accent)]/60 bg-[var(--accent-muted)]" : done ? "border-emerald-400/35 bg-white/[0.03] hover:bg-white/[0.05]" : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]"
            }`}
          >
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-white/45">
              {done && <Check className="h-3 w-3 text-emerald-300" />}
              {t("mining.stepN", { n: i + 1 })}
            </span>
            <b className="block text-[14px] text-white">{t(`mining.step${i + 1}`)}</b>
            {i === 3 && <span className="text-[11px] text-white/40">{t("mining.step4Sub")}</span>}
          </button>
        );
      })}
    </div>
  );
}
