import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { usePersistentState } from "../../lib/uiPersist";
import type { ChannelInfo, InstallOutcome, Pack } from "./types";
import { splitPacks, withOrphan } from "./state";
import { ChannelBar } from "./components/ChannelBar";
import { ActivePackHero } from "./components/ActivePackHero";
import { PackRows } from "./components/PackRows";
import { AddSourceForm } from "./components/AddSourceForm";
import { ConflictModal } from "./components/ConflictModal";

type Conflict = { pack: Pack; current: string };

export default function TranslationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[] | null>(null);
  const [selPath, setSelPath] = usePersistentState<string | null>("translation.channel", null);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const loadChannels = useCallback(() => {
    invoke<ChannelInfo[]>("translation_channels").then(setChannels).catch(() => setChannels([]));
  }, []);
  const loadPacks = useCallback(() => {
    invoke<Pack[]>("translation_feed").then(setPacks).catch(() => setPacks([]));
  }, []);

  useEffect(() => {
    loadChannels();
    loadPacks();
    invoke<boolean>("translation_auto_get").then(setAuto).catch(() => setAuto(false));
    const un = listen("trad:updated", () => loadChannels());
    return () => { void un.then((f) => f()); };
  }, [loadChannels, loadPacks]);

  const selected = useMemo(
    () => channels?.find((c) => c.path === selPath) ?? channels?.[0] ?? null,
    [channels, selPath],
  );
  const shown = useMemo(() => withOrphan(packs, selected), [packs, selected]);
  const split = useMemo(() => splitPacks(shown, selected), [shown, selected]);
  const [showSrc, setShowSrc] = useState(false);
  const packName = (id: string) => shown.find((p) => p.id === id)?.name ?? id.replace(/^custom:/, "");

  const fail = (title: string, e: unknown) => toast({ type: "error", title, message: String(e) });

  /** Exécute une opération sur le canal courant, puis recharge l'état. */
  const run = async (key: string, title: string, op: () => Promise<void>) => {
    setBusy(key);
    try { await op(); } catch (e) { fail(title, e); } finally { setBusy(null); loadChannels(); }
  };

  const install = (pack: Pack, force = false) =>
    run(pack.id, t("translation.install"), async () => {
      if (!selected) return;
      const res = await invoke<InstallOutcome>("translation_install", {
        channelPath: selected.path, packId: pack.id, folder: pack.folder, url: pack.url, force,
      });
      if (res.kind === "conflict") return setConflict({ pack, current: res.current });
      toast({ type: "success", title: t("translation.installedTitle"), message: t("translation.installedMsg", { pack: pack.name, channel: selected.label }) });
    });

  const update = (pack: Pack) =>
    run(pack.id, t("translation.update"), async () => {
      if (!selected) return;
      await invoke("translation_update", { channelPath: selected.path });
      toast({ type: "success", title: t("translation.updatedTitle"), message: pack.name });
    });

  const uninstall = (pack: Pack) =>
    run(pack.id, t("translation.uninstall"), async () => {
      if (!selected) return;
      await invoke("translation_uninstall", { channelPath: selected.path });
      toast({ type: "info", title: t("translation.uninstalledTitle"), message: pack.name });
    });

  const refresh = async () => {
    setRefreshing(true);
    try {
      setChannels(await invoke<ChannelInfo[]>("translation_check_updates"));
      loadPacks();
    } catch (e) { fail(t("translation.refresh"), e); } finally { setRefreshing(false); }
  };

  const addPath = async () => {
    const picked = await open({ directory: true, multiple: false, title: t("translation.addPathTitle") });
    if (typeof picked !== "string") return;
    try {
      await invoke("translation_add_channel", { path: picked });
      setSelPath(picked);
      loadChannels();
    } catch (e) { fail(t("translation.addPath"), e); }
  };

  const removePath = async (path: string) => {
    try {
      await invoke("translation_remove_channel", { path });
      loadChannels();
    } catch (e) { fail(t("translation.removePath"), e); }
  };

  const addSource = async (name: string, url: string) => {
    await invoke<Pack>("translation_add_source", { name, url });
    loadPacks();
  };

  const removeSource = async (pack: Pack) => {
    try { await invoke("translation_remove_source", { id: pack.id }); loadPacks(); }
    catch (e) { fail(t("translation.removeSource"), e); }
  };

  const toggleAuto = async () => {
    try { await invoke("translation_auto_set", { enabled: !auto }); setAuto(!auto); }
    catch (e) { fail(t("translation.autoLabel"), e); }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <ChannelBar
        channels={channels}
        selected={selected}
        onSelect={setSelPath}
        onAddPath={addPath}
        onRemovePath={removePath}
        onRefresh={refresh}
        refreshing={refreshing}
        packName={packName}
      />

      <header className="flex shrink-0 flex-wrap items-end gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("translation.subtitle")}</p>
          <h1 className="text-2xl font-bold text-white">{t("translation.title")}</h1>
        </div>
        <button
          type="button"
          onClick={toggleAuto}
          aria-pressed={auto}
          className="ml-auto flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-3.5 pr-2 text-[12.5px] text-white/55"
        >
          {t("translation.autoLabel")} <b className="font-semibold text-white">{auto ? t("translation.autoOn") : t("translation.autoOff")}</b>
          <span className={`relative h-5 w-[34px] rounded-full transition-colors ${auto ? "bg-emerald-500" : "bg-white/15"}`}>
            <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all ${auto ? "right-[3px]" : "left-[3px]"}`} />
          </span>
        </button>
      </header>

      <ActivePackHero
        pack={split.active}
        install={selected?.install ?? null}
        channelLabel={selected?.label ?? "—"}
        channelPath={selected?.path ?? null}
        busy={busy !== null}
        onUpdate={() => split.active && update(split.active)}
        onUninstall={() => split.active && uninstall(split.active)}
        onChange={() => document.getElementById("trad-packs")?.scrollIntoView({ behavior: "smooth" })}
        onRemoveSource={() => split.active && removeSource(split.active)}
      />

      <div id="trad-packs" className="flex items-center gap-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">{split.active ? t("translation.otherPacks") : t("translation.packs")}</h2>
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] tabular-nums text-white/40">{split.others.length}</span>
      </div>
      {split.others.length === 0 && !split.active ? (
        <p className="glass rounded-2xl p-6 text-center text-sm text-white/50">{t("translation.noPacks")}</p>
      ) : (
        <PackRows packs={split.others} busy={busy !== null} canAct={selected !== null} onInstall={(p) => install(p)} onRemoveSource={(p) => removeSource(p)} />
      )}

      {showSrc ? (
        <AddSourceForm onAdd={addSource} />
      ) : (
        <button type="button" onClick={() => setShowSrc(true)} className="glass flex items-center gap-2.5 rounded-2xl border-dashed px-4 py-3 text-left text-[13px] text-white/60 hover:text-white">
          + {t("translation.addSourceLine")}
        </button>
      )}

      <p className="shrink-0 text-[11px] text-white/35">{t("translation.footer")}</p>

      {conflict && selected && (
        <ConflictModal
          channel={selected.label}
          current={conflict.current}
          packName={conflict.pack.name}
          onCancel={() => setConflict(null)}
          onConfirm={() => { const p = conflict.pack; setConflict(null); void install(p, true); }}
        />
      )}
    </div>
  );
}
