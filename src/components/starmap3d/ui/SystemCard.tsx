import { useTranslation } from "react-i18next";
import type { SystemFacts } from "../panel";
import { FactGrid } from "./FactGrid";

/** Fiche du système affiché quand aucun lieu n'est choisi : description et nombre de corps. */
export function SystemCard({ name, facts }: { name: string; facts: SystemFacts }) {
  const { t } = useTranslation();
  const rows: [string, string][] = (
    [
      [t("starmap.panel.fact.planets"), facts.planets],
      [t("starmap.panel.fact.moons"), facts.moons],
      [t("starmap.panel.fact.stations"), facts.stations],
      [t("starmap.panel.fact.jumps"), facts.jumps],
      [t("starmap.panel.fact.belts"), facts.belts],
    ] as [string, number][]
  )
    .filter(([, n]) => n > 0)
    .map(([k, n]) => [k, String(n)]);
  return (
    <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl" aria-live="polite">
      <header className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(99,102,241,0.22),transparent_65%)] px-[18px] pb-3 pt-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/45">{t("starmap.panel.systemKind")}</p>
        <h2 className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-white">{name}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] pb-[18px] pt-3.5 [scrollbar-width:thin]">
        <FactGrid facts={rows} />
        {facts.description && <p className="text-[12.5px] leading-relaxed text-white/60">{facts.description}</p>}
        <p className="text-[12px] text-white/40">{t("starmap.panel.emptyHint")}</p>
      </div>
    </aside>
  );
}
