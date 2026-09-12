import { useNavigate } from "react-router";
import { type TFunction } from "i18next";
import { ArrowRight } from "lucide-react";
import { type MissionListItem } from "../../missionShared";
import StarmapMini from "../../../components/StarmapMini";
import { type WidgetDef, type DashData } from "../types";
import { PENDING_WIDGETS } from "../widgets";
import { computeCcuSuggestion } from "../helpers";
import { ClickableBody, PendingBox, NeutralBox } from "./boxes";
import { InsuranceBody } from "./InsuranceBody";
import { MissionsBody } from "./MissionsBody";
import { CcuBody } from "./CcuBody";
import { LocationsBody } from "./LocationsBody";
import { RoutesBody } from "./RoutesBody";
import { RsiStatusBody } from "./RsiStatusBody";
import { NewsBody } from "./NewsBody";

/* ─────────────────────────── Contenu des widgets ──────────────────────────── */

function WidgetBody({
  def,
  data,
  navigate,
  t,
  editing,
  onOpenMission,
}: {
  def: WidgetDef;
  data: DashData | null;
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction;
  editing: boolean;
  onOpenMission: (m: MissionListItem) => void;
}) {
  // Titre eyebrow, avec lien d'accent optionnel à droite (missions / ccu).
  const renderTitle = (linkLabel?: string) => (
    <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-white/50">
      <span>{t(def.titleKey)}</span>
      {linkLabel && (
        <span className="normal-case tracking-normal text-[var(--accent)]">{linkLabel}</span>
      )}
    </div>
  );
  const title = renderTitle();

  // Widgets restant en coquille (Lot 4 : carte galactique).
  if (PENDING_WIDGETS.has(def.key)) {
    return (
      <>
        {title}
        <PendingBox def={def} t={t} />
      </>
    );
  }

  // Tant que les données ne sont pas chargées : neutre.
  if (!data) {
    return (
      <>
        {title}
        <NeutralBox def={def} span={def.span} />
      </>
    );
  }

  switch (def.key) {
    case "ships":
      if (!data.core) break;
      return (
        <>
          {title}
          <div className="text-2xl font-bold text-white">{data.core.shipsCount}</div>
          <div className="mt-1 text-xs text-white/50">
            {t("dashboard.wShipsLti", { count: data.core.ltiCount })}
          </div>
        </>
      );

    case "insurance":
      return (
        <>
          {title}
          <InsuranceBody ships={data.insurance} t={t} />
        </>
      );

    case "starmap":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/starmap")}>
          {renderTitle(t("dashboard.wStarmapLink"))}
          <StarmapMini t={t} />
        </ClickableBody>
      );

    case "missions": {
      const top = data.missions
        .filter((m) => m.rewardMax != null)
        .sort((a, b) => (b.rewardMax ?? 0) - (a.rewardMax ?? 0))
        .slice(0, 3);
      return (
        <>
          {renderTitle(t("dashboard.wMissionsLink"))}
          <MissionsBody missions={top} t={t} editing={editing} onOpen={onOpenMission} />
        </>
      );
    }

    case "ccu": {
      const sug = computeCcuSuggestion(data.ccuShips);
      if (!sug) {
        return (
          <>
            {renderTitle(t("dashboard.wCcuLink"))}
            <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
              {t("dashboard.wCcuNone")}
            </div>
          </>
        );
      }
      return (
        <ClickableBody
          editing={editing}
          onClick={() =>
            navigate("/ccu-chain", {
              state: { fromShipId: sug.from.shipId, toShipId: sug.to.shipId },
            })
          }
        >
          {renderTitle(t("dashboard.wCcuLink"))}
          <CcuBody from={sug.from} to={sug.to} delta={sug.delta} accent={def.accent} />
        </ClickableBody>
      );
    }

    case "locations":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/fleet")}>
          {renderTitle(t("dashboard.wLocationsLink"))}
          <LocationsBody ships={data.rentedShips} t={t} />
        </ClickableBody>
      );

    case "routes":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/cargo-routes")}>
          {renderTitle(t("dashboard.wRoutesLink"))}
          <RoutesBody result={data.topRoutes} t={t} editing={editing} navigate={navigate} />
        </ClickableBody>
      );

    case "rsiStatus":
      return (
        <ClickableBody editing={editing} onClick={() => navigate("/news")}>
          {title}
          <RsiStatusBody status={data.rsiStatus} t={t} />
        </ClickableBody>
      );

    case "news":
      return (
        <>
          {title}
          <NewsBody items={data.news} t={t} editing={editing} />
          {!editing && (
            <button
              onClick={() => navigate("/news")}
              className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] transition-opacity hover:opacity-80"
            >
              {t("dashboard.seeAll")}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </>
      );
  }

  // Repli neutre (données de la tranche absentes).
  return (
    <>
      {title}
      <NeutralBox def={def} span={def.span} />
    </>
  );
}

export { WidgetBody };
