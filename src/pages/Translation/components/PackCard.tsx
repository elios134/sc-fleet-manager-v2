import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Pack } from "../types";
import type { PackState } from "../state";

const STATE_STYLE: Record<PackState, { text: string; dot: string; key: string }> = {
  notInstalled: { text: "text-white/40", dot: "bg-white/40", key: "translation.packNotInstalled" },
  otherActive: { text: "text-white/40", dot: "bg-white/40", key: "translation.packNotInstalled" },
  upToDate: { text: "text-emerald-300", dot: "bg-emerald-400", key: "translation.packUpToDate" },
  updateAvailable: { text: "text-amber-300", dot: "bg-[var(--amber)]", key: "translation.packUpdate" },
};

const btn = "rounded-[10px] px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50";

/* Carte d'un pack : état sur le canal courant, aperçu des 3 clés témoin, actions. */
export function PackCard({
  pack,
  state,
  channelLabel,
  busy,
  canAct,
  onInstall,
  onUpdate,
  onUninstall,
  onRemoveSource,
}: {
  pack: Pack;
  state: PackState;
  channelLabel: string;
  busy: boolean;
  canAct: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onRemoveSource: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<[string, string][] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const installed = state === "upToDate" || state === "updateAvailable";
  const st = STATE_STYLE[state];

  const togglePreview = async () => {
    if (previewOpen) return setPreviewOpen(false);
    setPreviewOpen(true);
    if (preview) return;
    try {
      setPreview(await invoke<[string, string][]>("translation_preview", { url: pack.url }));
    } catch (e) {
      setPreviewErr(String(e));
    }
  };

  return (
    <article
      className={`flex flex-col gap-2.5 rounded-2xl border bg-black/40 px-4 py-4 backdrop-blur ${
        installed ? "border-[var(--accent)]/55" : "border-white/10"
      }`}
    >
      <header className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold text-white">{pack.name}</h3>
          <p className="mt-0.5 truncate text-xs text-white/40">{pack.custom ? pack.url : pack.author}</p>
        </div>
        {pack.featured && (
          <span className="shrink-0 rounded-md border border-[var(--accent)]/45 bg-[var(--accent)]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-200">
            {t("translation.recommended")}
          </span>
        )}
        {pack.custom && (
          <span className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/55">
            {t("translation.custom")}
          </span>
        )}
      </header>

      {pack.description && <p className="text-[13px] leading-snug text-white/55">{pack.description}</p>}

      {previewOpen && (
        <div className="rounded-[10px] border border-white/10 bg-white/[0.02]">
          {previewErr ? (
            <p className="px-3 py-2 text-xs text-red-400">{previewErr}</p>
          ) : !preview ? (
            <p className="px-3 py-2 text-xs text-white/40">{t("translation.previewLoading")}</p>
          ) : (
            preview.map(([k, v]) => (
              <div key={k} className="grid gap-0.5 border-t border-white/10 px-3 py-2 first:border-t-0">
                <span className="truncate font-mono text-[10.5px] text-white/40">{k}</span>
                <span className="text-[13px] text-white">{v}</span>
              </div>
            ))
          )}
        </div>
      )}

      <span className={`flex items-center gap-2 text-xs font-semibold ${st.text}`}>
        <span className={`h-[7px] w-[7px] rounded-full ${st.dot}`} />
        {t(st.key, { channel: channelLabel })}
      </span>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {state === "updateAvailable" && (
          <button type="button" disabled={busy} onClick={onUpdate} className={`${btn} bg-[var(--amber)] text-[#1a1205]`}>
            {t("translation.update")}
          </button>
        )}
        {!installed && (
          <button type="button" disabled={busy || !canAct} onClick={onInstall} className={`${btn} bg-[var(--accent)] text-white`}>
            {busy ? t("translation.working") : t("translation.install")}
          </button>
        )}
        <button type="button" onClick={togglePreview} className={`${btn} text-white/55 hover:text-white`}>
          {previewOpen ? t("translation.previewHide") : t("translation.preview")}
        </button>
        <span className="flex-1" />
        {installed && (
          <button type="button" disabled={busy} onClick={onUninstall} className={`${btn} border border-red-400/35 text-red-400`}>
            {t("translation.uninstall")}
          </button>
        )}
        {pack.custom && !installed && (
          <button type="button" onClick={onRemoveSource} className={`${btn} text-white/55 hover:text-white`}>
            {t("translation.removeSource")}
          </button>
        )}
      </div>
    </article>
  );
}
