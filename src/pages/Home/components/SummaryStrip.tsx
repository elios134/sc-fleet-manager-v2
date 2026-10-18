import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HomeData } from "../useHomeData";
import { appLocale } from "../../../lib/format";
import { bestRouteState } from "../home";

/* Rangée de résumés compacts, chacun ouvrant sa page complète (masqué sans donnée). */
export function SummaryStrip({ data: d, onOpen }: { data: HomeData; onOpen: (to: string, state?: unknown) => void }) {
  const { t } = useTranslation();
  const route = d.routes?.routes[0] ?? null;
  const channel = d.channels.find((c) => c.install) ?? null;
  const tiles: ReactNode[] = [];

  if (d.fleet && d.fleet.shipsCount > 0) {
    tiles.push(
      <Tile key="fleet" title={t("nav.hub.fleet")} onOpen={() => onOpen("/fleet")}>
        <p className="truncate text-[22px] font-extrabold tabular-nums">{d.fleet.shipsCount}<small className="ml-1 text-[11.5px] font-medium text-white/45">{t("home.ships")}</small></p>
        <p className="truncate text-[11.5px] text-white/45">{t("home.lti", { n: d.fleet.ltiCount })}</p>
      </Tile>,
    );
  }
  if (d.top.length > 0) {
    tiles.push(
      <Tile key="inv" title={t("nav.hub.inventory")} onOpen={() => onOpen("/inventory")}>
        <div className="flex gap-1.5">
          {d.top.map((x) => (
            <span key={x.classe} title={d.meta[x.classe]?.name ?? x.classe} className="relative grid h-[34px] w-[34px] place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
              {d.meta[x.classe]?.imageUrl ? <img src={d.meta[x.classe]!.imageUrl!} alt="" className="max-h-[80%] max-w-[80%] object-contain" /> : null}
              <em className="absolute -bottom-1 -right-1 rounded-full bg-[#0a0a0f]/90 px-1 text-[9.5px] font-extrabold not-italic">{x.qte}</em>
            </span>
          ))}
        </div>
        <p className="truncate text-[11.5px] text-white/45">{t("home.invPlaces", { n: Object.keys(d.inventory?.possessions ?? {}).length })}</p>
      </Tile>,
    );
  }
  if (route) {
    tiles.push(
      <Tile key="route" title={t("home.bestRoute")} onOpen={() => onOpen("/commerce/cargo", bestRouteState(d.routes))}>
        <p className="truncate text-[22px] font-extrabold tabular-nums text-emerald-300">+{Math.round(route.profit).toLocaleString(appLocale())}<small className="ml-1 text-[11.5px] font-medium text-white/45">aUEC</small></p>
        <p className="truncate text-[11.5px] text-white/45">{route.fromLocation} → {route.toLocation}</p>
      </Tile>,
    );
  }
  if (d.journal && d.journal.blueprintsUnlocked > 0) {
    tiles.push(
      <Tile key="craft" title={t("nav.tab.crafting")} onOpen={() => onOpen("/industry/crafting")}>
        <p className="truncate text-[22px] font-extrabold tabular-nums">{d.journal.blueprintsUnlocked}<small className="ml-1 text-[11.5px] font-medium text-white/45">{t("home.blueprints")}</small></p>
        <p className="truncate text-[11.5px] text-white/45">{t("home.blueprintsUnlocked")}</p>
      </Tile>,
    );
  }
  if (channel?.install) {
    const custom = channel.install.packId.startsWith("custom:");
    tiles.push(
      <Tile key="trad" title={t("nav.tab.traduction")} onOpen={() => onOpen("/tools/traduction")}>
        <p className="truncate text-[22px] font-extrabold">{custom ? t("home.customPack") : channel.install.packId.toUpperCase()}</p>
        <p className="truncate text-[11.5px] text-white/45">{channel.label} · {channel.install.updateAvailable ? t("home.updateAvailable") : t("home.upToDate")}</p>
      </Tile>,
    );
  }
  if (tiles.length === 0) return null;
  return <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">{tiles}</section>;
}

function Tile({ title, onOpen, children }: { title: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} className="glass flex min-w-0 flex-col gap-1 rounded-2xl px-3.5 py-3 text-left hover:border-white/20" style={{ background: "rgba(20,20,32,0.34)" }}>
      <span className="flex text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/60">{title}<span className="ml-auto text-indigo-300">→</span></span>
      {children}
    </button>
  );
}
