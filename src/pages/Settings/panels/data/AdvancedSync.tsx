import { useTranslation } from "react-i18next";
import type { DataSync } from "../../hooks/useDataSync";
import type { ReactNode } from "react";
import { SyncButton, SyncResult } from "./SyncButton";

/** Groupe de synchros d'une source : nom, ce qu'elle alimente, ses boutons. */
function SyncGroup({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12.5px] font-semibold text-white/80">
        {title} <span className="font-normal text-white/45">— {desc}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Synchronisation avancée (repliée) : chaque étape lançable seule, avec son récap. */
export function AdvancedSync({ sync: s }: { sync: DataSync }) {
  const { t } = useTranslation();
  const p = s.progress;
  const prog = (phase: string, key: string) =>
    p && p.phase === phase && p.total > 0 ? t(key, { current: p.current, total: p.total }) : t("settings.donnees.syncInProgress");
  const err = (n: number) => (n > 0 ? t("settings.donnees.errorsSuffix", { errors: n }) : "");
  const off = s.anyBusy;

  return (
    <div className="border-t border-white/[0.09] pt-2.5">
      <button
        type="button"
        aria-expanded={s.advancedOpen}
        onClick={() => s.setAdvancedOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[12.5px] font-semibold text-white/55 hover:text-white"
      >
        <span>
          {t("settings.donnees.advancedTitle")} <span className="font-normal text-white/40">· {t("settings.donnees.advancedHint")}</span>
        </span>
        <span className={`transition-transform ${s.advancedOpen ? "rotate-180" : ""}`}>▾</span>
      </button>

      {s.advancedOpen && (
        <div className="mt-3 flex flex-col gap-3">
          <SyncGroup title={t("settings.donnees.sourceWikiName")} desc={t("settings.donnees.sourceWikiDesc")}>
            <SyncButton busy={s.syncing} disabled={off} onClick={() => void s.syncWiki()}>
              {s.syncing ? prog("vehicles", "settings.donnees.syncShipsProgress") : t("settings.donnees.syncShipsBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingComp} disabled={off} onClick={() => void s.syncComponents()}>
              {s.syncingComp ? prog("components", "settings.donnees.syncPageProgress") : t("settings.donnees.syncCompBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingMissions} disabled={off} onClick={() => void s.syncMissions()}>
              {s.syncingMissions ? prog("missions", "settings.donnees.syncPageProgress") : t("settings.donnees.syncMissionsBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingBlueprints} disabled={off} onClick={() => void s.syncBlueprints()}>
              {s.syncingBlueprints
                ? p && p.phase === "blueprint-missions" && p.total > 0
                  ? t("settings.donnees.syncBlueprintsLinks", { current: p.current, total: p.total })
                  : prog("blueprints", "settings.donnees.syncPageProgress")
                : t("settings.donnees.syncBlueprintsBtn")}
            </SyncButton>
          </SyncGroup>
          <SyncGroup title={t("settings.donnees.sourceCargoName")} desc={t("settings.donnees.sourceCargoDesc")}>
            <SyncButton busy={s.syncingCargoPos} disabled={off} onClick={() => void s.syncCargoPositions()}>
              {s.syncingCargoPos ? t("settings.donnees.syncInProgress") : t("settings.donnees.cargoPositionsBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingStarmapWiki} disabled={off} onClick={() => void s.syncStarmapWiki()}>
              {s.syncingStarmapWiki ? t("settings.donnees.syncInProgress") : t("settings.donnees.syncStarmapWikiBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingStarmapWiki} disabled={off} onClick={() => void s.syncStarmapRsi()}>
              {s.syncingStarmapWiki ? t("settings.donnees.syncInProgress") : t("settings.donnees.syncStarmapRsiBtn")}
            </SyncButton>
          </SyncGroup>
          <SyncGroup title={t("settings.donnees.sourceUexName")} desc={t("settings.donnees.sourceUexDesc")}>
            <SyncButton busy={s.syncingUex} disabled={off} onClick={() => void s.syncUex()}>
              {s.syncingUex ? t("settings.donnees.syncInProgress") : t("settings.donnees.uexBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingItemCat} disabled={off} onClick={() => void s.syncItemCatalog()}>
              {s.syncingItemCat ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogItemsBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingVehMkt} disabled={off} onClick={() => void s.syncVehicleMarketplace()}>
              {s.syncingVehMkt ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogVehiclesBtn")}
            </SyncButton>
            <SyncButton busy={s.syncingItemImg} disabled={off || s.syncingItemImg} onClick={() => void s.syncItemImages()}>
              {s.syncingItemImg ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogImagesBtn")}
            </SyncButton>
          </SyncGroup>

          {s.result && (
            <SyncResult>
              {t("settings.donnees.shipsResult", { vehicles: s.result.vehiclesSynced, hardpoints: s.result.hardpointsSynced })}
              {err(s.result.errors)}
              {s.result.sample ? t("settings.donnees.sampleSuffix") : ""}
              {s.result.sample && s.result.sampledShips && s.result.sampledShips.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-emerald-200/80">
                  {s.result.sampledShips.map((x) => (
                    <li key={x.name}>• {t("settings.donnees.shipSlots", { name: x.name, hardpoints: x.hardpoints })}</li>
                  ))}
                </ul>
              )}
            </SyncResult>
          )}
          {s.compResult && (
            <SyncResult>
              {t("settings.donnees.compResult", { count: s.compResult.componentsSynced })}
              {err(s.compResult.errors)}
              {s.compResult.sample ? t("settings.donnees.sampleSuffix") : ""}
            </SyncResult>
          )}
          {s.missionResult && (
            <SyncResult>
              {t("settings.donnees.missionsResult", { count: s.missionResult.missionsSynced })}
              {err(s.missionResult.errors)}
            </SyncResult>
          )}
          {s.blueprintResult && (
            <SyncResult>
              {t("settings.donnees.blueprintsResult", { count: s.blueprintResult.blueprintsSynced })}
              {t("settings.donnees.blueprintsLinks", { count: s.blueprintResult.missionLinksCreated })}
              {s.blueprintResult.missionLinksSkipped > 0 ? t("settings.donnees.blueprintsLinksSkipped", { count: s.blueprintResult.missionLinksSkipped }) : ""}
              {err(s.blueprintResult.errors)}
            </SyncResult>
          )}
          {s.starmapResult && (
            <SyncResult>
              {t("settings.donnees.starmapResult", { count: s.starmapResult.bodiesWritten, stanton: s.starmapResult.stanton, pyro: s.starmapResult.pyro, nyx: s.starmapResult.nyx })}
              {err(s.starmapResult.errors)}
            </SyncResult>
          )}
          {s.cargoPosResult && (
            <SyncResult>
              {t("settings.donnees.cargoPositionsResult", { positions: s.cargoPosResult.positions, hubs: s.cargoPosResult.auditHubsMatched, hubsTotal: s.cargoPosResult.auditHubsTotal })}
            </SyncResult>
          )}
          {s.uexResult && (
            <SyncResult>
              {t("settings.donnees.uexResult", { prices: s.uexResult.prices, terminals: s.uexResult.terminals, mapped: s.uexResult.terminalsMapped, hubs: s.uexResult.hubsMatched, hubsTotal: s.uexResult.hubsTotal })}
            </SyncResult>
          )}
          {s.itemImgResult && <SyncResult>{t("settings.donnees.catalogImagesResult", { updated: s.itemImgResult.updated, withImage: s.itemImgResult.withImage })}</SyncResult>}
          {s.itemCatResult && (
            <SyncResult>
              {t("settings.donnees.catalogItemsResult", { items: s.itemCatResult.items, categories: s.itemCatResult.categories, prices: s.itemCatResult.prices })}
              {err(s.itemCatResult.errors.length)}
            </SyncResult>
          )}
          {s.vehMktResult && (
            <SyncResult>
              {t("settings.donnees.catalogVehiclesResult", { buy: s.vehMktResult.vehiclesPurchase, buyPoints: s.vehMktResult.purchasePoints, rent: s.vehMktResult.vehiclesRental, rentPoints: s.vehMktResult.rentalPoints })}
            </SyncResult>
          )}
        </div>
      )}
    </div>
  );
}
