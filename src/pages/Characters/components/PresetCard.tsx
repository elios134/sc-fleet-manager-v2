import { useTranslation } from "react-i18next";
import { Check, Download, Heart, Loader2, UserRound } from "lucide-react";
import type { CatalogPreset } from "../types";

/** Carte d'un preset du site : vignette, titre, auteur, compteurs, installation. */
export function PresetCard({
  p,
  installed,
  busy,
  disabled,
  onInstall,
}: {
  p: CatalogPreset;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
}) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(i18n.language);
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[var(--glass)] transition-colors hover:border-[var(--accent)]/50">
      <div className="relative aspect-[4/5] bg-[var(--surface-panel)]">
        {p.previewUrl ? (
          <img src={p.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="absolute inset-0 m-auto h-10 w-10 text-white/20" />
        )}
        {installed && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-[var(--success)]/40 bg-[var(--surface-black)]/70 px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
            <Check className="h-3 w-3" /> {t("characters.inGame")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
        <div className="min-w-0">
          <b className="block truncate font-semibold text-white" title={p.title}>{p.title || "—"}</b>
          {p.author && <span className="block truncate text-xs text-white/55">{t("characters.by", { author: p.author })}</span>}
        </div>
        <div className="flex gap-3 text-[11.5px] tabular-nums text-white/55">
          <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{n(p.downloads)}</span>
          <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{n(p.likes)}</span>
        </div>
        <button
          type="button"
          disabled={installed || busy || disabled}
          onClick={onInstall}
          className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed ${installed ? "border border-white/15 bg-white/[0.06] text-white/50" : "bg-[var(--accent)] text-white hover:brightness-110 disabled:opacity-40"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : !installed && <Download className="h-3.5 w-3.5" />}
          {installed ? t("characters.alreadyInstalled") : t("characters.install")}
        </button>
      </div>
    </article>
  );
}
