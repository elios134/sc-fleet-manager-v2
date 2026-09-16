import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OverlaySettings } from "../../../lib/overlayPreferences";

/* Panneau de configuration de l'overlay (repris de l'ancien OverlayCard des Réglages,
   rendu contrôlé : l'état vit dans la page pour alimenter l'aperçu en direct). */

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-5 w-9 flex-none items-center rounded-full p-0.5 transition-colors"
      style={{ background: on ? "var(--accent)" : "rgba(255,255,255,0.15)", justifyContent: on ? "flex-end" : "flex-start" }}
      aria-pressed={on}
    >
      <span className="h-4 w-4 rounded-full bg-white" />
    </button>
  );
}

function Row({ label, hint, ctrl }: { label: string; hint?: string; ctrl: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/5 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white/80">{label}</div>
        {hint && <div className="text-[11px] text-white/40">{hint}</div>}
      </div>
      {ctrl}
    </div>
  );
}

export default function OverlayConfig({
  s,
  patch,
  onToggle,
  onReposition,
  onReset,
}: {
  s: OverlaySettings;
  patch: (p: Partial<OverlaySettings>) => void;
  onToggle: () => void;
  onReposition: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium ${on ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="min-w-0">
            <p className="text-sm text-white/80">{t("settings.overlay.title")}</p>
            <p className="mt-1 text-xs text-white/50">{t("settings.overlay.desc")}</p>
          </div>
          <button
            onClick={onToggle}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
            style={{ background: "var(--accent)" }}
          >
            {t("settings.overlay.toggle")}
          </button>
        </div>

        <Row label={t("settings.overlay.clickThrough")} hint={t("settings.overlay.clickThroughHint")} ctrl={<Switch on={s.clickThrough} onClick={() => patch({ clickThrough: !s.clickThrough })} />} />
        <Row label={t("settings.overlay.lock")} ctrl={<Switch on={s.locked} onClick={() => patch({ locked: !s.locked })} />} />
        <Row label={t("settings.overlay.compact")} hint={t("settings.overlay.compactHint")} ctrl={<Switch on={s.compact} onClick={() => patch({ compact: !s.compact })} />} />
        <Row
          label={t("settings.overlay.opacity")}
          ctrl={
            <div className="flex flex-none items-center gap-2">
              <input
                type="range" min={40} max={100} step={5} value={Math.round(s.opacity * 100)}
                onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                className="w-28 accent-[var(--accent)]"
              />
              <span className="w-9 text-right text-xs text-white/70">{Math.round(s.opacity * 100)}%</span>
            </div>
          }
        />
        <button onClick={onReposition} className="mt-3 w-full rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/15">
          {t("settings.overlay.reposition")}
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.style")}</p>
        <div className="flex gap-2">
          {(["projection", "panel"] as const).map((style) => (
            <button key={style} onClick={() => patch({ visualStyle: style })} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${s.visualStyle === style ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`}>
              {t(`settings.overlay.style${style === "projection" ? "Projection" : "Panel"}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.panels")}</p>
        <div className="flex gap-2">
          {(["route", "timers"] as const).map((k) => (
            <button
              key={k}
              onClick={() => patch({ panels: { ...s.panels, [k]: !s.panels[k] } })}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${s.panels[k] ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`}
            >
              {k === "route" ? t("settings.overlay.panelRoute") : t("settings.overlay.panelTimers")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.routeDetails")}</p>
        <div className="flex flex-wrap gap-2">
          {([["scu", "detailScu"], ["time", "detailTime"], ["fuel", "detailFuel"], ["profit", "detailProfit"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => patch({ routeDetails: { ...s.routeDetails, [k]: !s.routeDetails[k] } })} className={chip(s.routeDetails[k])}>
              {t(`settings.overlay.${lbl}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.timersContent")}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => patch({ timers: { ...s.timers, hangar: !s.timers.hangar } })} className={chip(s.timers.hangar)}>
            {t("settings.overlay.timerHangar")}
          </button>
          <button onClick={() => patch({ timers: { ...s.timers, independent: !s.timers.independent } })} className={chip(s.timers.independent)}>
            {t("settings.overlay.timerIndependent")}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.defaultTab")}</p>
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {(["route", "timers"] as const).map((k) => (
            <button
              key={k}
              onClick={() => patch({ defaultTab: k })}
              className={`flex-1 px-3 py-1.5 text-xs font-medium ${s.defaultTab === k ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/60"}`}
            >
              {k === "route" ? t("settings.overlay.panelRoute") : t("settings.overlay.panelTimers")}
            </button>
          ))}
        </div>
        <button onClick={onReset} className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/60 hover:bg-white/10">
          {t("settings.overlay.reset")}
        </button>
      </div>
    </div>
  );
}
