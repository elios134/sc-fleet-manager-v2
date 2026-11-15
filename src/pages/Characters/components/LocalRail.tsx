import { useTranslation } from "react-i18next";
import { Copy, FolderOpen, X } from "lucide-react";
import { FactionEmblem } from "../../../components/FactionEmblem";
import { factionHue } from "../../../lib/reputation";
import type { LocalGroup } from "../lib/presets";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

/** Colonne « Dans le jeu » : presets installés, copie vers les autres versions, suppression. */
export function LocalRail({
  groups,
  gameFound,
  canCopy,
  onCopy,
  onDelete,
  onOpenFolder,
}: {
  groups: LocalGroup[];
  gameFound: boolean;
  canCopy: boolean;
  onCopy: (g: LocalGroup) => void;
  onDelete: (g: LocalGroup) => void;
  onOpenFolder: () => void;
}) {
  const { t, i18n } = useTranslation();
  const icon = "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-white/[0.12] bg-white/[0.04] text-white/60";
  return (
    <aside className="glass rounded-[18px] p-4 lg:sticky lg:top-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("characters.inGameTitle")}</p>
        <span className="text-xs tabular-nums text-white/55">{t("characters.localCount", { count: groups.length })}</span>
      </div>
      {!gameFound && <p className="mt-3 text-sm text-white/55">{t("characters.noGame")}</p>}
      {gameFound && groups.length === 0 && <p className="mt-3 text-sm text-white/55">{t("characters.noLocal")}</p>}
      <div className="mt-1.5">
        {groups.map((g) => (
          <div key={g.name} className="flex items-center gap-2.5 border-b border-white/[0.06] py-2.5 last:border-b-0">
            <FactionEmblem mono={initials(g.name)} hue={factionHue(g.name)} />
            <div className="min-w-0 flex-1">
              <b className="block truncate font-semibold text-white">{g.name}</b>
              <span className="text-xs text-white/55">
                {g.channels.join(", ")}
                {g.modifiedAt ? ` · ${t("characters.addedOn", { date: new Date(g.modifiedAt).toLocaleDateString(i18n.language) })}` : ""}
              </span>
            </div>
            {canCopy && (
              <button type="button" title={t("characters.copyOthers")} aria-label={t("characters.copyOthers")} onClick={() => onCopy(g)} className={`${icon} hover:text-white`}>
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" title={t("characters.delete")} aria-label={t("characters.delete")} onClick={() => onDelete(g)} className={`${icon} hover:border-[var(--danger)]/40 hover:text-[var(--danger)]`}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!gameFound}
        onClick={onOpenFolder}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[11px] border border-white/15 bg-white/[0.06] px-3.5 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
      >
        <FolderOpen className="h-4 w-4" /> {t("characters.openFolder")}
      </button>
      <p className="mt-3 text-xs text-white/50">{t("characters.howTo")}</p>
    </aside>
  );
}
