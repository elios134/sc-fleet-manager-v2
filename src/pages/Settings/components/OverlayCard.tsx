import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";
import { PhysicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  createOverlayDefaults,
  enableManualPositioning,
  normalizeOverlaySettings,
  type OverlaySettings,
} from "../../../lib/overlayPreferences";

function OvSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
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

function OverlayCard() {
  const { t } = useTranslation();
  const [s, setS] = useState<OverlaySettings>(createOverlayDefaults);

  useEffect(() => {
    const load = async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.settings" }).catch(() => null);
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        setS(normalizeOverlaySettings(p));
      } catch {
        /* défaut */
      }
    };
    void load();
    const un = listen("overlay:settings-changed", () => void load());
    return () => { void un.then((f) => f()); };
  }, []);

  const persist = (next: OverlaySettings) => {
    void invoke("set_app_meta", { key: "overlay.settings", value: JSON.stringify(next) }).catch(() => {});
    void emit("overlay:settings-changed").catch(() => {});
  };

  const patch = (p: Partial<OverlaySettings>) =>
    setS((cur) => {
      const next = { ...cur, ...p };
      persist(next);
      return next;
    });

  function repositionOverlay() {
    setS((cur) => {
      const next = enableManualPositioning(cur);
      persist(next);
      return next;
    });
    void invoke("show_overlay").catch(() => {});
  }

  async function resetGeom() {
    void invoke("set_app_meta", { key: "overlay.geom", value: "" }).catch(() => {});
    try {
      const w = await WebviewWindow.getByLabel("overlay");
      if (!w) return;
      await w.setSize(new PhysicalSize(360, 480));
      // Recale sur un coin visible du 1er moniteur (évite un overlay resté hors champ).
      try {
        const mons = await availableMonitors();
        if (mons.length) await w.setPosition(new PhysicalPosition(mons[0].position.x + 40, mons[0].position.y + 40));
      } catch { /* pas de moniteurs */ }
    } catch {
      /* overlay fermé */
    }
  }

  const Row = ({ label, hint, ctrl }: { label: string; hint?: string; ctrl: ReactNode }) => (
    <div className="flex items-center gap-3 border-b border-white/5 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white/80">{label}</div>
        {hint && <div className="text-[11px] text-white/40">{hint}</div>}
      </div>
      {ctrl}
    </div>
  );
  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium ${on ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`;

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.label")}</p>
      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="min-w-0">
            <p className="text-sm text-white/80">{t("settings.overlay.title")}</p>
            <p className="mt-1 text-xs text-white/50">{t("settings.overlay.desc")}</p>
          </div>
          <button
            onClick={() => void invoke("toggle_overlay").catch(() => {})}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
            style={{ background: "var(--accent)" }}
          >
            {t("settings.overlay.toggle")}
          </button>
        </div>

        <Row label={t("settings.overlay.clickThrough")} hint={t("settings.overlay.clickThroughHint")} ctrl={<OvSwitch on={s.clickThrough} onClick={() => patch({ clickThrough: !s.clickThrough })} />} />
        <Row label={t("settings.overlay.lock")} ctrl={<OvSwitch on={s.locked} onClick={() => patch({ locked: !s.locked })} />} />
        <Row label={t("settings.overlay.compact")} hint={t("settings.overlay.compactHint")} ctrl={<OvSwitch on={s.compact} onClick={() => patch({ compact: !s.compact })} />} />
        <Row
          label={t("settings.overlay.opacity")}
          ctrl={
            <div className="flex flex-none items-center gap-2">
              <input
                type="range" min={40} max={100} step={5} value={Math.round(s.opacity * 100)}
                onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                className="w-28"
              />
              <span className="w-9 text-right text-xs text-white/70">{Math.round(s.opacity * 100)}%</span>
            </div>
          }
        />

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.style")}</div>
          <div className="flex gap-2">
            {(["projection", "panel"] as const).map((style) => (
              <button key={style} onClick={() => patch({ visualStyle: style })} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${s.visualStyle === style ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`}>
                {t(`settings.overlay.style${style === "projection" ? "Projection" : "Panel"}`)}
              </button>
            ))}
          </div>
        </div>

        <button onClick={repositionOverlay} className="mt-3 w-full rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/15">
          {t("settings.overlay.reposition")}
        </button>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.panels")}</div>
          <div className="flex gap-2">
            {(["route", "timers"] as const).map((k) => (
              <button
                key={k}
                onClick={() => patch({ panels: { ...s.panels, [k]: !s.panels[k] } })}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                  s.panels[k] ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"
                }`}
              >
                {k === "route" ? t("settings.overlay.panelRoute") : t("settings.overlay.panelTimers")}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.routeDetails")}</div>
          <div className="flex flex-wrap gap-2">
            {([["scu", "detailScu"], ["time", "detailTime"], ["fuel", "detailFuel"], ["profit", "detailProfit"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => patch({ routeDetails: { ...s.routeDetails, [k]: !s.routeDetails[k] } })} className={chip(s.routeDetails[k])}>
                {t(`settings.overlay.${lbl}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.timersContent")}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => patch({ timers: { ...s.timers, hangar: !s.timers.hangar } })} className={chip(s.timers.hangar)}>
              {t("settings.overlay.timerHangar")}
            </button>
            <button onClick={() => patch({ timers: { ...s.timers, independent: !s.timers.independent } })} className={chip(s.timers.independent)}>
              {t("settings.overlay.timerIndependent")}
            </button>
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.defaultTab")}</div>
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
        </div>

        <button onClick={() => void resetGeom()} className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/60 hover:bg-white/10">
          {t("settings.overlay.reset")}
        </button>
      </div>
    </div>
  );
}

export { OverlayCard };
