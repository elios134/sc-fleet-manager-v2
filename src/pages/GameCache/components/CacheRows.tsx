import { useTranslation } from "react-i18next";
import { FileWarning, Layers, Folder } from "lucide-react";
import { KIND_COLOR, fmtSize, type CacheFolder } from "../lib/cache";
import { useFolderLabel } from "../lib/useFolderLabel";

const PILL: Record<string, string> = {
  shaders_old: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  shaders_current: "border-[var(--info)]/40 bg-[var(--info)]/10 text-[var(--info)]",
  crashes: "border-white/15 text-white/60",
  other: "border-white/15 text-white/60",
};

/** Une ligne par dossier : nature, explication, taille, suppression. */
export function CacheRows({ folders, disabled, onDelete }: { folders: CacheFolder[]; disabled: boolean; onDelete: (f: CacheFolder) => void }) {
  const { t, i18n } = useTranslation();
  const label = useFolderLabel();
  const max = Math.max(1, ...folders.map((f) => f.bytes));
  return (
    <section className="glass mt-3.5 rounded-[18px] px-[18px] py-1.5">
      {folders.map((f) => {
        const Icon = f.kind === "crashes" ? FileWarning : f.kind === "other" ? Folder : Layers;
        return (
          <div key={f.name} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-white/[0.06] py-3.5 last:border-b-0 md:grid-cols-[34px_minmax(0,1fr)_150px_110px_auto]">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px]" style={{ color: KIND_COLOR[f.kind], background: `color-mix(in oklab, ${KIND_COLOR[f.kind]} 18%, transparent)` }}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                {label(f)}
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL[f.kind]}`}>{t(`gameCache.kind.${f.kind}`)}</span>
              </p>
              <p className="text-xs text-white/55">{t(`gameCache.desc.${f.kind}`)}</p>
            </div>
            <div className="hidden h-1.5 overflow-hidden rounded-full bg-white/[0.06] md:block">
              <i className="block h-full" style={{ width: `${(f.bytes / max) * 100}%`, background: KIND_COLOR[f.kind] }} />
            </div>
            <b className="hidden text-right text-base tabular-nums text-white md:block">{fmtSize(f.bytes, i18n.language)}</b>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDelete(f)}
              className="rounded-[9px] border border-[var(--danger)]/45 bg-[var(--danger)]/[0.08] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("gameCache.delete")}
            </button>
          </div>
        );
      })}
    </section>
  );
}
