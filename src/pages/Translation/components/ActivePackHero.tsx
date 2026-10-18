import { useTranslation } from "react-i18next";
import type { InstallRow, Pack } from "../types";
import { usePreview } from "./usePreview";

const btn = "rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-50";

function ago(iso: string | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return "—";
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? t("translation.agoMin", { m }) : t("translation.agoHours", { h: Math.round(m / 60) });
}

/* Pack actif du canal en « héros » : état, faits, actions et aperçu façon écran mobiGlas. */
export function ActivePackHero({
  pack,
  install,
  channelLabel,
  channelPath,
  busy,
  onUpdate,
  onUninstall,
  onChange,
  onRemoveSource,
}: {
  pack: Pack | null;
  install: InstallRow | null;
  channelLabel: string;
  channelPath: string | null;
  busy: boolean;
  onUpdate: () => void;
  onUninstall: () => void;
  onChange: () => void;
  onRemoveSource: () => void;
}) {
  const { t } = useTranslation();
  const preview = usePreview(pack?.url ?? "", !!pack && !!install, channelPath ?? undefined);

  if (!pack || !install) {
    return (
      <section className="glass-hero flex flex-col items-start gap-2 rounded-2xl px-6 py-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">{t("translation.heroNone", { channel: channelLabel })}</p>
        <p className="text-lg font-bold text-white">{t("translation.heroPick")}</p>
        <button type="button" onClick={onChange} className={`${btn} bg-[var(--accent)] text-white`}>{t("translation.heroSeePacks")}</button>
      </section>
    );
  }

  const update = install.updateAvailable;
  return (
    <section className="glass-hero grid overflow-hidden rounded-2xl md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 px-6 py-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">{t("translation.heroInstalledOn", { channel: channelLabel })}</p>
        <p className="text-[26px] font-extrabold leading-none tracking-tight text-white">{pack.name}</p>
        <p className="-mt-1 flex flex-wrap items-center gap-2 text-[13px] text-white/60">
          {pack.custom ? t("translation.custom") : pack.author}
          {pack.featured && <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-200">{t("translation.recommended")}</span>}
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Fact label={t("translation.factState")} value={update ? t("translation.stateUpdate") : t("translation.stateOk")} tone={update ? "text-amber-300" : "text-emerald-300"} />
          <Fact label={t("translation.factChecked")} value={ago(install.checkedAt, t)} />
          <Fact label={t("translation.factEffect")} value={t("translation.factNextLaunch")} />
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {update && <button type="button" disabled={busy} onClick={onUpdate} className={`${btn} bg-[var(--amber)] text-[#1a1205]`}>{t("translation.update")}</button>}
          <button type="button" onClick={onChange} className={`${btn} border border-white/15 bg-white/[0.05] text-white`}>{t("translation.changePack")}</button>
          {pack.custom && (
            <button type="button" disabled={busy} onClick={onRemoveSource} className={`${btn} text-white/55 hover:text-white`}>{t("translation.removeSource")}</button>
          )}
          <button type="button" disabled={busy} onClick={onUninstall} className={`${btn} ml-auto border border-red-400/35 text-red-400`}>{t("translation.uninstall")}</button>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-white/10 bg-[linear-gradient(160deg,rgba(99,102,241,0.12),rgba(10,10,15,0.2))] px-6 py-5 md:border-l md:border-t-0">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">{t("translation.inGamePreview")}</p>
        {preview.error ? (
          <p className="text-xs text-red-400">{preview.error}</p>
        ) : !preview.rows ? (
          <p className="text-xs text-white/40">{t("translation.previewLoading")}</p>
        ) : (
          preview.rows.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-sky-300/25 bg-[rgba(8,20,32,0.65)] px-3.5 py-2.5 shadow-[inset_0_0_24px_rgba(56,189,248,0.08)]">
              <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-sky-200/55">{k}</p>
              <p className="mt-0.5 text-sm font-semibold text-sky-50">{v}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Fact({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/40">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}
