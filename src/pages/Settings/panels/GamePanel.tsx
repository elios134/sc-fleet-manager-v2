import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { GameLogCard } from "../components/GameLogCard";
import { InstallCard } from "./game/InstallCard";
import { DataminingCard } from "./game/DataminingCard";

/* Panneau Jeu : installation Star Citizen, lecteur Game.log, overlay (résumé → onglet Overlay),
   datamining. */
export function GamePanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <InstallCard />
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <GameLogCard />
        <section className="glass flex min-w-0 flex-col gap-3 rounded-2xl px-5 py-[18px]">
          <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-white">
            {t("settings.overlay.label")}
            <kbd className="ml-auto rounded-md border border-white/15 bg-white/[0.06] px-1.5 font-mono text-[11px] text-white/80">F6</kbd>
          </h2>
          <p className="text-[12.5px] leading-relaxed text-white/50">{t("settings.overlay.desc")}</p>
          <button
            type="button"
            onClick={() => navigate("/tools/overlay")}
            className="self-start rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10"
          >
            {t("settings.overlay.openTab")}
          </button>
        </section>
      </div>
      <DataminingCard />
    </>
  );
}
