import { useTranslation } from "react-i18next";
import { KIND_COLOR, fmtSize, safeFolders, totalBytes, type CacheInfo } from "../lib/cache";
import { useFolderLabel } from "../lib/useFolderLabel";

/** Espace occupé, répartition, état du jeu et actions groupées. */
export function CacheSummary({ info, onFreeSafe, onClearAll }: { info: CacheInfo; onFreeSafe: () => void; onClearAll: () => void }) {
  const { t, i18n } = useTranslation();
  const label = useFolderLabel();
  const total = totalBytes(info.folders);
  const safe = totalBytes(safeFolders(info.folders));
  const size = (b: number) => fmtSize(b, i18n.language);
  return (
    <section className="glass grid grid-cols-1 items-center gap-5 rounded-[18px] px-6 py-[22px] md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("gameCache.used")}</p>
        <p className="text-[40px] font-extrabold tabular-nums tracking-tight text-white">{size(total)}</p>
        <div className="mt-3.5 flex h-3 gap-0.5 overflow-hidden rounded-full bg-white/5">
          {info.folders.map((f) => (
            <i key={f.name} className="block h-full" style={{ width: `${total ? (f.bytes / total) * 100 : 0}%`, background: KIND_COLOR[f.kind] }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3.5 text-xs text-white/60">
          {info.folders.map((f) => (
            <span key={f.name} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: KIND_COLOR[f.kind] }} />
              {label(f)} · {size(f.bytes)}
            </span>
          ))}
        </div>
        <p
          className={`mt-3.5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${info.gameRunning ? "border-[var(--warning)]/30 bg-[var(--warning)]/[0.08] text-[var(--warning)]" : "border-[var(--success)]/25 bg-[var(--success)]/[0.08] text-[var(--success)]"}`}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
          {info.gameRunning ? t("gameCache.running") : t("gameCache.closed")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" disabled={info.gameRunning || safe === 0} onClick={onFreeSafe} className="rounded-[11px] bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          {t("gameCache.freeSafe", { size: size(safe) })}
        </button>
        <button type="button" disabled={info.gameRunning || total === 0} onClick={onClearAll} className="rounded-[11px] border border-[var(--danger)]/45 bg-[var(--danger)]/[0.08] px-3.5 py-2 text-sm font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/15 disabled:cursor-not-allowed disabled:opacity-40">
          {t("gameCache.clearAll", { size: size(total) })}
        </button>
        <span className="max-w-[240px] text-xs text-white/55">{t("gameCache.safeHint")}</span>
      </div>
    </section>
  );
}
