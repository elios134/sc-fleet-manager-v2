// Accueil unique en « panorama » : le centre reste libre pour le fond (logo de l'app au
// centre), alertes à gauche, statut à droite, résumés en bas. Ordre fixe ; un bloc sans
// donnée réelle ne s'affiche pas.
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import logo from "../../assets/logo.png";
import { useDatamining } from "../../contexts/DataminingContext";
import { placeLabel } from "../Inventory/resolve";
import { deriveAlerts, sessionState } from "./home";
import { useHomeData } from "./useHomeData";
import { AlertList } from "./components/AlertList";
import { StatusColumn } from "./components/StatusColumn";
import { SummaryStrip } from "./components/SummaryStrip";
import { LogbookCard } from "./components/LogbookCard";

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { patch } = useDatamining();
  const d = useHomeData();

  const alerts = useMemo(
    () =>
      deriveAlerts({
        insurance: d.insurance,
        channels: d.channels,
        uexAgeHours: d.uexAgeHours,
        gamelogEnabled: d.gamelog?.enabled ?? true,
        gamelogPathExists: d.gamelog?.pathExists ?? false,
      }),
    [d.insurance, d.channels, d.uexAgeHours, d.gamelog],
  );
  const session = sessionState(d.gamelog?.logAgeSecs ?? null, d.journal?.lastSession?.date ?? null, new Date());
  const location = d.gamelog?.currentLocation ?? d.journal?.lastSession?.location ?? null;
  const today = new Date().toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="mx-auto grid h-full max-w-[1500px] grid-cols-1 gap-4 overflow-y-auto px-6 pb-28 pt-2 lg:grid-cols-[330px_minmax(0,1fr)_300px] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:overflow-hidden">
      {/* Haut : salut + session, écrits directement sur le fond */}
      <header className="flex flex-wrap items-end gap-4 [text-shadow:0_2px_16px_rgba(0,0,0,0.7)] lg:col-span-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/45">{today}</p>
          <h1 className="text-[28px] font-bold text-white">
            {d.handle ? t("home.greetingName", { name: d.handle }) : t("home.greeting")}
          </h1>
        </div>
        {session.kind === "live" ? (
          <span className="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-wide text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            {t("home.live")}
          </span>
        ) : session.sinceMinutes != null ? (
          <span className="mb-1.5 text-xs text-white/50">{t("home.offlineSince", { m: session.sinceMinutes })}</span>
        ) : null}
        {location && (
          <div className="ml-auto text-right">
            <p className="text-xl font-bold text-white">{placeLabel(location)}</p>
            {patch?.installedVersion && (
              <p className="text-xs text-white/55">
                {patch.installedChannel ?? "LIVE"} · {patch.installedVersion}
              </p>
            )}
          </div>
        )}
      </header>

      {/* Gauche : à faire + carnet */}
      <aside className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto [scrollbar-width:none]">
        <AlertList alerts={alerts} onOpen={(to) => navigate(to)} />
        {d.journal && <LogbookCard journal={d.journal} onOpen={() => navigate("/missions/carnet")} />}
      </aside>

      {/* Centre : fenêtre sur le fond, logo de l'app */}
      <div className="pointer-events-none order-first flex min-h-[34vh] items-center justify-center lg:order-none">
        <img src={logo} alt="" aria-hidden className="w-56 select-none opacity-80 drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" draggable={false} />
      </div>

      {/* Droite : hangar, serveurs, actualités */}
      <StatusColumn hangar={d.hangar} servers={d.servers} news={d.news} onAllNews={() => navigate("/news")} />

      {/* Bas : résumés */}
      <div className="lg:col-span-3">
        <SummaryStrip data={d} onOpen={(to) => navigate(to)} />
      </div>
    </div>
  );
}
