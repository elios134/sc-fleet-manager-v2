// Onglet « Personnages » du hub Outils (maquette docs/design/maquette-personnages-cache.html, variante A) :
// catalogue de star-citizen-characters.com à gauche, presets installés dans le jeu à droite.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, Search } from "lucide-react";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import { useToast } from "../../components/Toast";
import { usePersistentState } from "../../lib/uiPersist";
import type { CatalogOrder, CatalogPage, CatalogPreset, LocalPresets } from "./types";
import { installedNames, isInstalled, mergePages, uniqueLocal, type LocalGroup } from "./lib/presets";
import { PresetCard } from "./components/PresetCard";
import { LocalRail } from "./components/LocalRail";

const SITE = "https://www.star-citizen-characters.com/";

export default function CharactersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [order, setOrder] = usePersistentState<CatalogOrder>("characters.order", "download");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<CatalogPreset[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalPresets>({ characters: [], gameFound: true, channels: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LocalGroup | null>(null);

  const loadLocal = useCallback(() => {
    invoke<LocalPresets>("characters_local").then(setLocal).catch(() => setLocal({ characters: [], gameFound: false, channels: [] }));
  }, []);
  useEffect(loadLocal, [loadLocal]);

  // Recherche appliquée 400 ms après la dernière frappe.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query.trim()), 400);
    return () => window.clearTimeout(id);
  }, [query]);

  const fetchPage = useCallback(
    (n: number) => {
      setLoading(true);
      setError(null);
      invoke<CatalogPage>("characters_catalog", { page: n, order, search })
        .then((d) => {
          setRows((prev) => (n === 1 ? d.rows : mergePages(prev, d.rows)));
          setHasNext(d.hasNextPage);
          setPage(n);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [order, search],
  );
  useEffect(() => fetchPage(1), [fetchPage]);

  const names = useMemo(() => installedNames(local.characters), [local]);
  const groups = useMemo(() => uniqueLocal(local.characters), [local]);

  const install = async (p: CatalogPreset) => {
    setBusy(p.id);
    try {
      const done = await invoke<string[]>("characters_install", { dnaUrl: p.dnaUrl, title: p.title });
      toast({ type: "success", title: t("characters.installed", { name: p.title }), message: t("characters.installedIn", { channels: done.join(", ") }) });
      loadLocal();
    } catch (e) {
      toast({ type: "error", title: t("characters.installFailed"), message: String(e) });
    } finally {
      setBusy(null);
    }
  };
  const copy = async (g: LocalGroup) => {
    try {
      const done = await invoke<string[]>("characters_copy", { path: g.paths[0] });
      toast({ type: "success", title: t("characters.copied", { name: g.name }), message: done.length ? done.join(", ") : t("characters.copiedNone") });
      loadLocal();
    } catch (e) {
      toast({ type: "error", title: t("characters.copyOthers"), message: String(e) });
    }
  };
  const remove = async (g: LocalGroup) => {
    try {
      for (const path of g.paths) await invoke("characters_delete", { path });
      loadLocal();
    } catch (e) {
      toast({ type: "error", title: t("characters.delete"), message: String(e) });
    } finally {
      setToDelete(null);
    }
  };
  const openFolder = () => invoke("characters_open_folder").catch((e) => toast({ type: "error", title: t("characters.openFolder"), message: String(e) }));

  const seg = (k: CatalogOrder, label: string) => (
    <button type="button" aria-pressed={order === k} onClick={() => setOrder(k)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${order === k ? "bg-[var(--accent)] text-white" : "text-white/60 hover:text-white"}`}>
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto px-6 pb-28 pt-4">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-3.5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">star-citizen-characters.com</p>
            <h1 className="text-2xl font-bold text-white">{t("characters.title")}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("characters.searchPh")}
                className="w-[260px] rounded-[11px] border border-white/[0.12] bg-[var(--surface-input)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--accent)]"
              />
            </label>
            <div className="inline-flex gap-0.5 rounded-full border border-white/[0.09] bg-white/5 p-[3px]">
              {seg("download", t("characters.popular"))}
              {seg("latest", t("characters.recent"))}
            </div>
            <button type="button" onClick={() => void openUrl(SITE)} className="inline-flex items-center gap-1.5 rounded-[11px] border border-white/15 bg-white/[0.06] px-3.5 py-2 text-sm font-semibold text-white hover:bg-white/10">
              <ExternalLink className="h-4 w-4" /> {t("characters.openSite")}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            {error && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2.5 text-sm text-[var(--danger)]">
                <span className="flex-1">{t("characters.siteError")}</span>
                <Button variant="secondary" onClick={() => fetchPage(1)}>{t("characters.retry")}</Button>
              </div>
            )}
            {!loading && !error && rows.length === 0 && <p className="py-10 text-center text-sm text-white/45">{t("characters.noResult")}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {rows.map((p) => (
                <PresetCard key={p.id} p={p} installed={isInstalled(p.title, names)} busy={busy === p.id} disabled={!local.gameFound || busy != null} onInstall={() => void install(p)} />
              ))}
            </div>
            <div className="mt-3.5 flex justify-center">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              ) : (
                hasNext && <Button variant="secondary" onClick={() => fetchPage(page + 1)}>{t("characters.more")}</Button>
              )}
            </div>
          </section>
          <LocalRail groups={groups} gameFound={local.gameFound} canCopy={local.channels.length > 1} onCopy={(g) => void copy(g)} onDelete={setToDelete} onOpenFolder={() => void openFolder()} />
        </div>
      </div>

      {toDelete && (
        <Modal
          size="sm"
          onClose={() => setToDelete(null)}
          title={t("characters.deleteTitle", { name: toDelete.name })}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setToDelete(null)}>{t("characters.cancel")}</Button>
              <Button className="!bg-[var(--danger)]" onClick={() => void remove(toDelete)}>{t("characters.delete")}</Button>
            </div>
          }
        >
          <p className="text-sm text-white/65">{t("characters.deleteText", { channels: toDelete.channels.join(", ") })}</p>
        </Modal>
      )}
    </div>
  );
}
