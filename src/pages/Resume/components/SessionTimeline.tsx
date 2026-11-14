import { useTranslation } from "react-i18next";
import { describeItem, type Tone } from "../lib/timeline";
import type { SessionItem } from "../types";

const DOT: Record<Tone, string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  accent: "var(--accent)",
  mute: "rgba(255,255,255,0.38)",
};

/** Frise verticale de la dernière session, la plus récente en haut. */
export function SessionTimeline({ items }: { items: SessionItem[] }) {
  const { t, i18n } = useTranslation();
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="glass rounded-[18px] px-5 py-[18px]">
      <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("resume.lastSession")}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">{t("resume.noEvents")}</p>
      ) : (
        <ol className="relative pl-[22px] before:absolute before:bottom-1.5 before:left-1.5 before:top-1.5 before:w-0.5 before:bg-white/[0.08]">
          {items.map((it, i) => {
            const v = describeItem(it);
            return (
              <li key={`${it.at}-${i}`} className="relative pb-4 last:pb-0">
                <span
                  className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--background)]"
                  style={{ background: DOT[v.tone] }}
                />
                <p className="text-[11px] tabular-nums text-white/40">{time(it.at)}</p>
                <p className="font-semibold text-white">
                  {t(v.titleKey, { count: v.count ?? 1 })}
                  {v.title ? ` · ${v.title}` : ""}
                </p>
                {(v.rep?.length || v.loot) ? (
                  <p className="text-xs text-white/55">
                    {v.rep?.map((r) => (
                      <span key={r.faction} className="mr-2">
                        {r.faction} · <b className="text-[var(--success)]">+{r.amount.toLocaleString(i18n.language)} {t("resume.repShort")}</b>
                      </span>
                    ))}
                    {v.loot ? t("resume.loot", { count: v.loot }) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
