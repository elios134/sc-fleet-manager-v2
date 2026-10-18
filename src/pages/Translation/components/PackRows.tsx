import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Pack } from "../types";
import { usePreview } from "./usePreview";

const btn = "rounded-[10px] px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50";

/* Autres packs en liste compacte (aperçu dépliable sous la ligne). */
export function PackRows({
  packs,
  busy,
  canAct,
  onInstall,
  onRemoveSource,
}: {
  packs: Pack[];
  busy: boolean;
  canAct: boolean;
  onInstall: (p: Pack) => void;
  onRemoveSource: (p: Pack) => void;
}) {
  return (
    <div className="glass flex flex-col overflow-hidden rounded-2xl">
      {packs.map((p, i) => (
        <PackRow key={p.id} pack={p} first={i === 0} busy={busy} canAct={canAct} onInstall={() => onInstall(p)} onRemove={() => onRemoveSource(p)} />
      ))}
    </div>
  );
}

function PackRow({ pack, first, busy, canAct, onInstall, onRemove }: { pack: Pack; first: boolean; busy: boolean; canAct: boolean; onInstall: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = usePreview(pack.url, open);
  return (
    <div className={first ? "" : "border-t border-white/10"}>
      <div className="grid grid-cols-1 items-center gap-3.5 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-bold text-white">
            {pack.name}
            {pack.featured && <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/20 px-1.5 text-[9.5px] font-bold uppercase text-indigo-200">{t("translation.recommended")}</span>}
          </p>
          <p className="truncate text-xs text-white/40">{pack.custom ? pack.url : pack.author}</p>
        </div>
        <p className="text-[12.5px] text-white/60">{pack.description}</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setOpen((o) => !o)} className={`${btn} text-white/60 hover:text-white`}>{open ? t("translation.previewHide") : t("translation.preview")}</button>
          <button type="button" disabled={busy || !canAct} onClick={onInstall} className={`${btn} bg-[var(--accent)] text-white`}>{busy ? t("translation.working") : t("translation.install")}</button>
          {pack.custom && <button type="button" onClick={onRemove} className={`${btn} text-white/60 hover:text-white`}>{t("translation.removeSource")}</button>}
        </div>
      </div>
      {open && (
        <div className="grid gap-2 px-4 pb-3 sm:grid-cols-3">
          {preview.error ? (
            <p className="text-xs text-red-400">{preview.error}</p>
          ) : !preview.rows ? (
            <p className="text-xs text-white/40">{t("translation.previewLoading")}</p>
          ) : (
            preview.rows.map(([k, v]) => (
              <div key={k} className="rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="truncate font-mono text-[10.5px] text-white/40">{k}</p>
                <p className="text-[13px] text-white">{v}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
