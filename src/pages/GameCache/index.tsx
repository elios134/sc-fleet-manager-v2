// Onglet « Cache du jeu » du hub Outils (maquette docs/design/maquette-personnages-cache.html) : dossiers de
// %LOCALAPPDATA%\Star Citizen, ce qui est sans risque, suppression confirmée et refusée si le jeu tourne.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { FolderOpen, HardDrive, Loader2, RefreshCw } from "lucide-react";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { fmtSize, safeFolders, totalBytes, type CacheFolder, type CacheInfo } from "./lib/cache";
import { CacheSummary } from "./components/CacheSummary";
import { CacheRows } from "./components/CacheRows";
import { useFolderLabel } from "./lib/useFolderLabel";

export default function GameCachePage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const label = useFolderLabel();
  const [info, setInfo] = useState<CacheInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CacheFolder[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setInfo(null);
    invoke<CacheInfo>("game_cache_info")
      .then((d) => {
        setInfo(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (folders: CacheFolder[]) => {
    setBusy(true);
    try {
      const freed = await invoke<number>("game_cache_delete", { names: folders.map((f) => f.name) });
      toast({ type: "success", title: t("gameCache.title"), message: t("gameCache.freed", { size: fmtSize(freed, i18n.language) }) });
    } catch (e) {
      toast({ type: "error", title: t("gameCache.deleteFailed"), message: String(e) });
    } finally {
      setBusy(false);
      setConfirm(null);
      load();
    }
  };
  const open = () => invoke("game_cache_open").catch((e) => toast({ type: "error", title: t("gameCache.openFolder"), message: String(e) }));
  const btn = "inline-flex items-center gap-1.5 rounded-[11px] border border-white/15 bg-white/[0.06] px-3.5 py-2 text-sm font-semibold text-white hover:bg-white/10";

  return (
    <div className="h-full overflow-y-auto px-6 pb-28 pt-4">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-3.5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">%LOCALAPPDATA%\Star Citizen</p>
            <h1 className="text-2xl font-bold text-white">{t("gameCache.title")}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void open()} className={btn}><FolderOpen className="h-4 w-4" /> {t("gameCache.openFolder")}</button>
            <button type="button" onClick={load} className={btn}><RefreshCw className="h-4 w-4" /> {t("gameCache.refresh")}</button>
          </div>
        </header>
        {error && <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">{error}</p>}
        {!info && !error && (
          <div className="flex justify-center py-16 text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}
        {info && info.folders.length === 0 && <EmptyState icon={HardDrive} title={t("gameCache.emptyTitle")} text={t("gameCache.emptyText")} />}
        {info && info.folders.length > 0 && (
          <>
            <CacheSummary info={info} onFreeSafe={() => setConfirm(safeFolders(info.folders))} onClearAll={() => setConfirm(info.folders)} />
            <CacheRows folders={info.folders} disabled={info.gameRunning} onDelete={(f) => setConfirm([f])} />
          </>
        )}
      </div>

      {confirm && (
        <Modal
          size="sm"
          onClose={() => !busy && setConfirm(null)}
          title={t("gameCache.confirmTitle")}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>{t("gameCache.cancel")}</Button>
              <Button className="!bg-[var(--danger)]" disabled={busy} onClick={() => void run(confirm)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("gameCache.confirmDelete", { size: fmtSize(totalBytes(confirm), i18n.language) })}
              </Button>
            </div>
          }
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">
            {confirm.map((f) => (
              <li key={f.name}>
                {label(f)} · {fmtSize(f.bytes, i18n.language)}
                {f.kind === "shaders_current" ? ` (${t("gameCache.slowerNext")})` : ""}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
