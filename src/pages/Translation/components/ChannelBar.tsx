import { useTranslation } from "react-i18next";
import { Info, Plus, RefreshCw, X } from "lucide-react";
import type { ChannelInfo } from "../types";

/* Bandeau du haut : détection Star Citizen + canaux (un pack actif par canal).
 * Variante orange « introuvable » quand aucun canal n'est connu. */
export function ChannelBar({
  channels,
  selected,
  onSelect,
  onAddPath,
  onRemovePath,
  onRefresh,
  refreshing,
  packName,
}: {
  channels: ChannelInfo[] | null;
  selected: ChannelInfo | null;
  onSelect: (path: string) => void;
  onAddPath: () => void;
  onRemovePath: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  packName: (packId: string) => string;
}) {
  const { t } = useTranslation();
  const found = (channels?.length ?? 0) > 0;
  // Pendant le chargement (channels === null) : état neutre, pas d'alerte orange qui clignote.
  const loading = channels === null;
  const alert = !loading && !found;
  const root = selected?.path.replace(/[\\/][^\\/]+$/, "") ?? "";

  const dot = (c: ChannelInfo) =>
    !c.install ? "bg-white/40" : c.install.updateAvailable ? "bg-[var(--amber)]" : "bg-emerald-400";
  const sub = (c: ChannelInfo) =>
    !c.install
      ? t("translation.channelNone")
      : `${packName(c.install.packId)} · ${c.install.updateAvailable ? t("translation.stateUpdate") : t("translation.stateOk")}`;

  return (
    <section
      className={`shrink-0 rounded-2xl border backdrop-blur ${
        alert ? "border-[var(--amber)]/45 bg-[var(--amber-muted)]" : "border-white/10 bg-black/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 text-[13px]">
        <span className={`flex items-center gap-2 font-bold ${alert ? "text-amber-300" : "text-white"}`}>
          <span className={`h-2 w-2 rounded-full ${loading ? "bg-white/40" : found ? "bg-emerald-400" : "bg-[var(--amber)]"}`} />
          {loading ? t("translation.scSearching") : found ? t("translation.scFound") : t("translation.scMissing")}
        </span>
        {found && <code className="break-all font-mono text-xs text-white/55">{root}</code>}
        {alert && <span className="text-white/55">{t("translation.scMissingHint")}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        {channels?.map((c) => (
          <span key={c.path} className="flex items-center">
          <button
            type="button"
            onClick={() => onSelect(c.path)}
            title={c.path}
            className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-semibold ${
              selected?.path === c.path
                ? "border-[var(--accent)]/60 bg-[var(--accent)]/20 text-white"
                : "border-white/15 bg-white/[0.03] text-white/90 hover:bg-white/[0.06]"
            }`}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${dot(c)}`} />
            {c.label}
            <span className="text-[11px] font-medium text-white/55">{sub(c)}</span>
          </button>
          {c.manual && !c.install && (
            <button
              type="button"
              onClick={() => onRemovePath(c.path)}
              title={t("translation.removePath")}
              aria-label={t("translation.removePath")}
              className="ml-1 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          </span>
        ))}
        <button
          type="button"
          onClick={onAddPath}
          className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] ${
            alert ? "border-[var(--amber)]/50 text-amber-300" : "border-dashed border-white/15 text-white/55"
          }`}
        >
          <Plus className="h-4 w-4" />
          {t("translation.addPath")}
        </button>
        {found && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="ml-auto flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] font-semibold text-white/55 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("translation.refresh")}
          </button>
        )}
      </div>

      {found && (
        <p className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5 text-xs text-white/55">
          <Info className="h-4 w-4 shrink-0" />
          {t("translation.nextLaunch")}
        </p>
      )}
    </section>
  );
}
