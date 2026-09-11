import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { CargoGridTab } from "../../components/CargoGridTab";
import { type FleetShip, type ShipGroup, type CargoRoute, type PricesStatus, type CargoCtx, type ActiveConvoy, type LoadToHoldRequest } from "./types";
import { ContextBar } from "./components/ContextBar";
import { ToolRail } from "./components/ToolRail";
import { ConvoyStrip } from "./components/ConvoyStrip";
import { PlannerTab } from "./tools/PlannerTab";
import { LoopPlannerTab } from "./tools/LoopPlannerTab";
import { GpsTradingTab } from "./tools/GpsTradingTab";

export default function CargoRoutesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState<"single" | "loop" | "gps" | "grid">("cargoRoutes.tab", "single");
  const [loadReq, setLoadReq] = useState<LoadToHoldRequest | null>(null);

  // ── Contexte de convoi PARTAGÉ (vaisseau · départ · budget) + données, piloté par les outils ──
  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<FleetShip[]>([]);
  const [group, setGroup] = usePersistentState<ShipGroup>("cargo.ctx.group", "fleet");
  const [shipName, setShipName] = usePersistentState<string>("cargo.ctx.ship", "");
  const [budget, setBudget] = usePersistentState<string>("cargo.ctx.budget", "1000000");
  const [system, setSystem] = usePersistentState<string>("cargo.ctx.system", "");
  const [prices, setPrices] = useState<PricesStatus | null>(null);

  // Convoi actif : l'état qui relie Trouver → Charger → Naviguer → Vendre.
  const [convoy, setConvoy] = useState<ActiveConvoy | null>(null);

  // Chargement : flotte + catalogue cargo + état du cache de prix (une fois, partagé).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, catalog, status] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<FleetShip[]>("get_cargo_catalog_ships"),
          invoke<PricesStatus>("get_uex_prices_status"),
        ]);
        if (!alive) return;
        setFleetShips(fleet);
        setCatalogShips(catalog);
        setPrices(status);
        if (!shipName) {
          if (fleet.length > 0) { setGroup("fleet"); setShipName(fleet[0].name); }
          else if (catalog.length > 0) { setGroup("all"); setShipName(catalog[0].name); }
        }
      } catch {
        /* la page affiche simplement l'état vide */
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ships = group === "fleet" ? fleetShips : catalogShips;
  const selectedShip = ships.find((s) => s.name === shipName) ?? null;

  function switchGroup(g: ShipGroup) {
    setGroup(g);
    const list = g === "fleet" ? fleetShips : catalogShips;
    setShipName(list.length > 0 ? list[0].name : "");
  }

  function loadToHold(shipN: string, commodity: string, scu: number) {
    setLoadReq({ shipName: shipN, commodity, scu, nonce: Date.now() });
    setTab("grid");
  }

  function startConvoy(route: CargoRoute) {
    setConvoy({ route, leg: 0, shipName, cargoScu: selectedShip?.cargoScu ?? route.quantityScu });
  }

  const ctx: CargoCtx = {
    t, ships, group, switchGroup,
    fleetCount: fleetShips.length, catalogCount: catalogShips.length,
    shipName, setShipName, selectedShip, budget, setBudget, system, setSystem, prices,
  };

  return (
    <div className="p-6">
      <header className="mb-1">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("cargo.eyebrow")}</p>
        <h1 className="text-2xl font-bold text-white">{t("cargo.title")}</h1>
        <p className="mt-1 max-w-xl text-[13px] text-white/45">{t("cargo.subtitle")}</p>
      </header>

      {/* Contexte de convoi partagé, toujours visible */}
      <ContextBar ctx={ctx} />

      {/* Rail (flux des 4 outils) + outil actif */}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <ToolRail tab={tab} setTab={(k) => { if (k === "grid") setLoadReq(null); setTab(k); }} t={t} />
        <div className="min-w-0 flex-1">
          {tab === "single" ? (
            <PlannerTab ctx={ctx} onLoadToHold={loadToHold} onStartConvoy={startConvoy} />
          ) : tab === "loop" ? (
            <LoopPlannerTab ctx={ctx} onLoadToHold={loadToHold} />
          ) : tab === "gps" ? (
            <GpsTradingTab ctx={ctx} onLoadToHold={loadToHold} />
          ) : (
            <CargoGridTab loadRequest={loadReq} defaultShip={shipName} />
          )}
        </div>
      </div>

      {/* Convoi actif : barre basse persistante */}
      {convoy && (
        <ConvoyStrip
          convoy={convoy}
          onAdvance={() => setConvoy((c) => (c ? { ...c, leg: c.leg + 1 } : c))}
          onClose={() => setConvoy(null)}
          t={t}
        />
      )}
    </div>
  );
}

/* ── Sous-composants ── */
