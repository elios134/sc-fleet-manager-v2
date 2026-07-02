import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowRight, Fuel, Loader2, X } from "lucide-react";
import type { GpsStep, TradeGraph } from "../pages/CargoRoutesPage";
import { SystemScene3D, type TripNode3D } from "./TripMap3D";

/* ── Type miroir de get_starmap_bodies (Vec<Value> côté Rust) ── */
type StarmapBodyItem = {
  id: string;
  systemName: string;
  navIcon: string;
  name: string;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
  hideInStarmap?: boolean;
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function cap(s: string | null): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ════════ TripMapModal — liste des sauts (gauche) + carte 3D adaptative (droite) ════════ */
export function TripMapModal({
  steps,
  startKey,
  graph,
  onClose,
}: {
  steps: GpsStep[];
  startKey: string;
  graph: TradeGraph;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<StarmapBodyItem[]>("get_starmap_bodies")
      .then((b) => alive && setBodies(b))
      .catch(() => alive && setBodies([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Séquence ordonnée des lieux visités : départ + chaque destination confirmée (avec z 3D).
  const nodes: TripNode3D[] = useMemo(() => {
    const arr: TripNode3D[] = [];
    const startName = graph.locations.find((l) => l.key === startKey)?.name ?? startKey;
    const startPos = graph.positions[startKey];
    arr.push({
      key: startKey,
      name: startName,
      system: startPos?.system ?? steps[0]?.leg.fromSystem ?? null,
      pos: startPos ? { x: startPos.x, y: startPos.y, z: startPos.z } : null,
    });
    for (const s of steps) {
      const p = graph.positions[s.leg.toKey];
      arr.push({
        key: s.leg.toKey,
        name: s.leg.toName ?? s.leg.toLocation,
        system: p?.system ?? s.leg.toSystem ?? null,
        pos: p ? { x: p.x, y: p.y, z: p.z } : null,
      });
    }
    return arr;
  }, [steps, startKey, graph]);

  // Règle 1/2 systèmes fondée sur le DERNIER saut (pas l'historique) :
  //  • dernière étape inter-système → 2 cases [P | S] (les 2 systèmes de CE saut) ;
  //  • sinon (intra-système ou aucune étape) → 1 case = système actuel.
  const mapWindow = useMemo(() => {
    if (nodes.length === 0) return null;
    const S = nodes[nodes.length - 1].system; // système du lieu courant
    const lastStep = steps.length ? steps[steps.length - 1] : null;
    const isJump = lastStep != null && lastStep.leg.fromSystem !== lastStep.leg.toSystem;

    if (isJump) {
      const entryIdx = nodes.length - 1; // lieu d'arrivée (système S)
      const exitIdx = nodes.length - 2; // dernier lieu dans P (= départ du saut)
      const P = nodes[exitIdx].system;
      // P-run : run contigu du système P se terminant au point de sortie.
      let a = exitIdx;
      while (a - 1 >= 0 && nodes[a - 1].system === P) a--;
      return {
        kind: "double" as const,
        pSystem: P,
        sSystem: S,
        pNodes: nodes.slice(a, exitIdx + 1),
        sNodes: nodes.slice(entryIdx), // l'arrivée (le saut vient d'avoir lieu)
        exitKey: nodes[exitIdx].key,
        entryKey: nodes[entryIdx].key,
      };
    }

    // 1 seule case : run contigu du système actuel se terminant au dernier lieu.
    let a = nodes.length - 1;
    while (a - 1 >= 0 && nodes[a - 1].system === S) a--;
    return { kind: "single" as const, sSystem: S, sNodes: nodes.slice(a) };
  }, [nodes, steps]);

  const currentKey = nodes.length ? nodes[nodes.length - 1].key : null;
  const cumulProfit = steps.reduce((acc, s) => acc + s.leg.profit, 0);
  const allTimed = steps.length > 0 && steps.every((s) => s.leg.timeMinutes != null);
  const cumulTime = allTimed ? steps.reduce((acc, s) => acc + (s.leg.timeMinutes ?? 0), 0) : null;

  // Carburant quantique : total consommé + étape où la distance CUMULÉE dépasse l'autonomie
  // (panne sèche si pas de ravitaillement avant).
  const rangeGm = graph.quantumRangeGm ?? null;
  const hasFuelData = rangeGm != null && rangeGm > 0;
  const cumulFuel = steps.reduce((acc, s) => acc + (s.leg.fuelScu ?? 0), 0);
  const refuelAtStep = (() => {
    if (!hasFuelData) return -1;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].leg.distanceGm ?? 0;
      if (acc > (rangeGm as number)) return i;
    }
    return -1;
  })();

  const bodiesFor = (sys: string | null) =>
    sys && bodies ? bodies.filter((b) => b.systemName?.toLowerCase() === sys.toLowerCase()) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex h-[90vh] w-[92vw] max-w-[1600px] flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10"
          aria-label={t("cargo.detail.close")}
        >
          <X className="h-5 w-5" />
        </button>

        <header className="shrink-0 px-6 pb-3 pt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("cargo.gps.mapTitle")}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
            <span>
              {t("cargo.gps.steps")} <span className="font-semibold text-white/80">{steps.length}</span>
            </span>
            <span>
              {t("cargo.gps.cumulProfit")}{" "}
              <span className="font-semibold text-emerald-400">+{fmt(cumulProfit)} aUEC</span>
            </span>
            <span>
              {t("cargo.gps.totalTime")}{" "}
              <span className="text-white/80">
                {cumulTime != null ? `${cumulTime.toFixed(1)} ${t("cargo.unit.min")}` : "—"}
              </span>
            </span>
            {hasFuelData && (
              <span>
                {t("cargo.gps.totalFuel")}{" "}
                <span className="text-sky-300">{cumulFuel.toFixed(2)} SCU</span>
                <span className="text-white/40"> · {t("cargo.gps.autonomy")} {(rangeGm as number).toFixed(0)} Gm</span>
              </span>
            )}
          </div>
        </header>

        {nodes.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/50">
            {t("cargo.gps.mapEmpty")}
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[300px_1fr]">
            {/* GAUCHE : tous les sauts (largeur fixe, scroll) */}
            <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">
                {t("cargo.gps.mapLegs")}
              </p>
              <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {steps.map((s, i) => {
                  const inter = s.leg.fromSystem !== s.leg.toSystem;
                  return (
                    <li key={i} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium capitalize text-white">
                          {s.leg.commodity}
                        </span>
                        <span className="shrink-0 text-[13px] font-semibold text-emerald-400">
                          +{fmt(s.leg.profit)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-white/60">
                        <span className="truncate capitalize">{s.leg.fromName ?? s.leg.fromLocation}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-white/30" />
                        <span className="truncate capitalize">{s.leg.toName ?? s.leg.toLocation}</span>
                      </div>
                      {inter && (
                        <span className="mt-1 inline-block rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--accent)]">
                          {t("cargo.gps.systemJump")}
                        </span>
                      )}
                      {hasFuelData && (
                        <span
                          className={`ml-1 mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium ${
                            i === refuelAtStep
                              ? "border-red-400/40 bg-red-400/10 text-red-300"
                              : "border-sky-400/30 bg-sky-400/10 text-sky-300"
                          }`}
                          title={i === refuelAtStep ? t("cargo.gps.refuelTitle") : t("cargo.gps.fuelTitle")}
                        >
                          <Fuel className="h-2.5 w-2.5" />
                          {s.leg.fuelScu != null ? `${s.leg.fuelScu.toFixed(2)} SCU` : "—"}
                          {i === refuelAtStep && ` · ${t("cargo.gps.refuelNeeded")}`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* DROITE : carte 3D adaptative (remplit la hauteur) */}
            <div className="min-h-0 rounded-xl border border-white/10 bg-black/10 p-4">
              {bodies === null ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("cargo.loading")}
                </div>
              ) : !mapWindow ? null : mapWindow.kind === "single" ? (
                <div className="flex h-full flex-col">
                  <p className="mb-2 shrink-0 text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    {cap(mapWindow.sSystem)}
                  </p>
                  <div className="min-h-0 flex-1">
                    <SystemScene3D
                      bodies={bodiesFor(mapWindow.sSystem)}
                      nodes={mapWindow.sNodes}
                      startKey={startKey}
                      currentKey={currentKey}
                      junctionKey={null}
                      t={t as TFunction}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col gap-3 lg:flex-row">
                  <div className="flex min-h-0 flex-1 flex-col">
                    <p className="mb-2 shrink-0 text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                      {cap(mapWindow.pSystem)}
                    </p>
                    <div className="min-h-0 flex-1">
                      <SystemScene3D
                        bodies={bodiesFor(mapWindow.pSystem)}
                        nodes={mapWindow.pNodes}
                        startKey={startKey}
                        currentKey={currentKey}
                        junctionKey={mapWindow.exitKey}
                        t={t as TFunction}
                      />
                    </div>
                  </div>

                  {/* Flèche de saut inter-système */}
                  <div className="flex shrink-0 flex-row items-center justify-center gap-1 lg:flex-col">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                      {t("cargo.gps.systemJump")}
                    </span>
                    <ArrowRight className="h-6 w-6 text-[var(--accent)]" />
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    <p className="mb-2 shrink-0 text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                      {cap(mapWindow.sSystem)}
                    </p>
                    <div className="min-h-0 flex-1">
                      <SystemScene3D
                        bodies={bodiesFor(mapWindow.sSystem)}
                        nodes={mapWindow.sNodes}
                        startKey={startKey}
                        currentKey={currentKey}
                        junctionKey={mapWindow.entryKey}
                        t={t as TFunction}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
