import { useTranslation } from "react-i18next";
import { FactionEmblem } from "../../../components/FactionEmblem";
import { factionHue, factionKey, progressPct } from "../../../lib/reputation";
import type { FactionRep } from "../../../lib/reputation";

/** Factions suivies, la plus récemment active d'abord. */
export function FactionList({ factions, selected, onSelect }: { factions: FactionRep[]; selected: string; onSelect: (key: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <aside className="glass flex flex-col gap-1.5 rounded-[18px] p-2.5">
      <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("reputation.myFactions")}</p>
      {factions.map((f) => {
        const key = factionKey(f);
        const on = key === selected;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={`flex w-full items-center gap-3 rounded-[14px] border p-2.5 text-left transition-colors ${on ? "border-[var(--accent)]/45 bg-[var(--accent-muted)]" : "border-transparent hover:bg-white/[0.04]"}`}
          >
            <FactionEmblem mono={f.monogram} hue={factionHue(f.faction)} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-semibold text-white">{f.faction}</b>
              <span className="block truncate text-xs text-white/55">
                {f.ranks[f.rankIndex]?.name}
                {f.scopeId !== "FactionReputation" && f.scopeLabel ? ` · ${f.scopeLabel}` : ""}
              </span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <i className="block h-full bg-[var(--accent)]" style={{ width: `${Math.max(progressPct(f), 3)}%` }} />
              </span>
            </span>
            <span className="font-bold tabular-nums text-[var(--success)]">+{f.gained.toLocaleString(i18n.language)}</span>
          </button>
        );
      })}
      <p className="px-2 pb-1 pt-2 text-xs text-white/50">{t("reputation.listHint")}</p>
    </aside>
  );
}
