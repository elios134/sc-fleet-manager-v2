import { useTranslation } from "react-i18next";
import type { HangarStatus, NewsItem, RsiServerStatus } from "../useHomeData";

const PANEL = "glass flex flex-col gap-2 rounded-2xl px-4 py-3";
const PANEL_BG = { background: "rgba(20,20,32,0.34)" };
const fmtLeft = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.max(1, Math.round(s / 60))} min`);

/* Colonne de droite : hangar PYAM, serveurs RSI, actualités (chaque bloc seulement si dispo). */
export function StatusColumn({ hangar, servers, news, onAllNews }: { hangar: HangarStatus | null; servers: RsiServerStatus | null; news: NewsItem[]; onAllNews: () => void }) {
  const { t } = useTranslation();
  const open = hangar?.status.status === "ONLINE";
  return (
    <aside className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto [scrollbar-width:none]">
      {hangar && (
        <section className={PANEL} style={PANEL_BG}>
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/60">{t("home.hangar")}</h3>
          <p className={`text-[26px] font-extrabold leading-none ${open ? "text-emerald-300" : "text-white/80"}`}>{open ? t("home.hangarOpen") : t("home.hangarClosed")}</p>
          <p className="text-[11.5px] text-white/45">
            {t(open ? "home.hangarClosesIn" : "home.hangarOpensIn", { left: fmtLeft(hangar.status.secondsRemaining) })}
          </p>
        </section>
      )}
      {servers && (
        <section className={PANEL} style={PANEL_BG}>
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/60">{t("home.servers")}</h3>
          {servers.components.slice(0, 3).map((c) => (
            <p key={c.name} className="flex items-center gap-2 text-[12.5px] text-white/60">
              <span className={`h-[7px] w-[7px] rounded-full ${/operational/i.test(c.status) ? "bg-emerald-400" : "bg-[var(--amber)]"}`} />
              <b className="font-semibold text-white">{c.name}</b>
            </p>
          ))}
        </section>
      )}
      {news.length > 0 && (
        <section className={PANEL} style={PANEL_BG}>
          <h3 className="flex items-center text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/60">
            {t("home.news")}
            <button type="button" onClick={onAllNews} className="ml-auto text-[11.5px] font-semibold normal-case tracking-normal text-indigo-300">
              {t("home.all")}
            </button>
          </h3>
          {news.slice(0, 3).map((n) => (
            <a key={n.link} href={n.link} target="_blank" rel="noreferrer" className="truncate text-[12.5px] text-white/70 hover:text-white">
              {n.title}
            </a>
          ))}
        </section>
      )}
    </aside>
  );
}
