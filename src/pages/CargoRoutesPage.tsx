import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { usePersistentState } from "../lib/uiPersist";
import { Loader2, PackageSearch, ArrowRight, Truck, Fuel, MapPin, Repeat, Box, Calculator, RotateCcw, RefreshCw, Infinity as InfinityIcon, ChevronDown, ChevronRight, Play, Check, Rocket, Coins, Navigation, X, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RouteDetailsModal } from "../components/RouteDetailsModal";
import { TripMapModal } from "../components/TripMapModal";
import { CargoGridTab } from "../components/CargoGridTab";
import Dropdown from "../components/ui/Dropdown";

/* ── Types (miroir des structs Rust, camelCase serde) ── */
type FleetShip = {
  name: string;
  manufacturer: string | null;
  cargoScu: number | null;
  role: string | null;
  qtDefault?: boolean; // présent pour le catalogue (groupe « tous cargo »)
};
type ShipGroup = "fleet" | "all";
// Identité minimale d'une route transmise par le widget dashboard pour pré-ouverture.
type PendingRoute = {
  shipName: string;
  commodity: string;
  fromLocation: string;
  toLocation: string;
};
export type CargoRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  fromName: string | null;
  toName: string | null;
  fromUuid: string | null;
  toUuid: string | null;
  buyPrice: number;
  sellPrice: number;
  marginUnit: number;
  quantityScu: number;
  profit: number;
  fromSystem: string | null;
  toSystem: string | null;
  jumps: number | null;
  distanceGm: number | null;
  timeMinutes: number | null;
  profitPerMinute: number | null;
  priceTimestamp: string | null;
  fuel: number | null;
  // Carburant quantique consommé par ce leg (SCU) = distanceGm × conso drive. null si non synchro.
  fuelScu: number | null;
};
type FindRoutesResult = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  investment: number;
  routesConsidered: number;
  routesWithTime: number;
  routes: CargoRoute[];
  note: string;
};
type LoopResult = {
  legs: CargoRoute[];
  totalProfit: number;
  totalTimeMinutes: number | null;
  hops: number;
  closed: boolean;
  startLocation: string;
  endLocation: string;
  note: string | null;
};
type PricesStatus = {
  rows: number;
  terminals: number;
  terminalsMapped: number;
  freshestTimestamp: string | null;
  sellPointsWithDemand: number;
};

/* ── Types GPS trading (miroir TradeGraph Rust) ── */
export type Affluence = "low" | "medium" | "high";
export type GpsLeg = CargoRoute & { fromKey: string; toKey: string; affluence: Affluence };

/* ── Overlay en jeu : la route choisie (quel que soit l'outil) est poussée vers la
   fenêtre overlay via AppMeta « overlay.nav » + l'event « overlay:nav ». L'overlay
   l'affiche étape par étape et surligne l'étape courante selon le lieu détecté. ── */
type OverlayStep = {
  from: string;
  to: string;
  commodity?: string;
  profit?: number;
  scu?: number;
  minutes?: number;
  jumps?: number;
  fuel?: number; // SCU de carburant quantique du leg
  distanceGm?: number; // distance du leg (Gm) → alerte ravitaillement cumulée
};
type OverlayRoute =
  | {
      source: "single" | "loop" | "gps" | "cart";
      shipName?: string;
      rangeGm?: number | null; // autonomie quantique (Gm) → calcul du ravitaillement
      steps: OverlayStep[];
    }
  | null;

function legToStep(leg: CargoRoute): OverlayStep {
  return {
    from: leg.fromName ?? leg.fromLocation,
    to: leg.toName ?? leg.toLocation,
    commodity: leg.commodity,
    profit: leg.profit,
    scu: leg.quantityScu ?? undefined,
    minutes: leg.timeMinutes ?? undefined,
    jumps: leg.jumps ?? undefined,
    fuel: leg.fuelScu ?? undefined,
    distanceGm: leg.distanceGm ?? undefined,
  };
}

function pushOverlayRoute(route: OverlayRoute) {
  void invoke("set_app_meta", { key: "overlay.nav", value: JSON.stringify(route) }).catch(() => {});
  void emit("overlay:nav", route).catch(() => {});
}
type GpsBuyItem = {
  commodity: string;
  buyPrice: number;
  stock: number | null;
  statusBuy: number | null;
  outOfStock: boolean;
};
type GpsLocation = { key: string; name: string; system: string | null };
export type GpsPos = { x: number; y: number; z: number; system: string | null };
export type TradeGraph = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  // Autonomie quantique max (Gm) et capacité réservoir (SCU). null si non synchronisées.
  quantumRangeGm: number | null;
  quantumFuelScu: number | null;
  legsFrom: Record<string, GpsLeg[]>;
  buyableAt: Record<string, GpsBuyItem[]>;
  positions: Record<string, GpsPos>;
  locations: GpsLocation[];
};
// Une étape confirmée du trajet GPS (leg = CargoRoute → modale + soute compatibles).
export type GpsStep = { leg: GpsLeg };

const SYSTEMS = ["stanton", "pyro", "nyx"] as const;

/* ── Helpers ── */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function relativeAge(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return t("cargo.ageMinutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("cargo.ageHours", { n: hours });
  return t("cargo.ageDays", { n: Math.floor(hours / 24) });
}
// Prix frais (< 60 min) → pastille verte, sinon ambre. null = timestamp absent/invalide.
function priceFresh(iso: string | null): boolean | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 60000 < 60;
}
// Tri des routes : profit (défaut), rentabilité (profit/min), temps (croissant).
type RouteSort = "profit" | "ppm" | "time";
function sortRoutes(routes: CargoRoute[], key: RouteSort): CargoRoute[] {
  const s = [...routes];
  if (key === "ppm") s.sort((a, b) => (b.profitPerMinute ?? -Infinity) - (a.profitPerMinute ?? -Infinity));
  else if (key === "time") s.sort((a, b) => (a.timeMinutes ?? Infinity) - (b.timeMinutes ?? Infinity));
  else s.sort((a, b) => b.profit - a.profit);
  return s;
}

/* ══════════════════════════ COCKPIT DE CONVOI ══════════════════════════ */
// Contexte de convoi PARTAGÉ : vaisseau · départ · budget, définis une fois et pilotant
// les outils. Remonté au wrapper CargoRoutesPage et passé aux outils.
type CargoCtx = {
  t: TFunction;
  ships: FleetShip[];
  group: ShipGroup;
  switchGroup: (g: ShipGroup) => void;
  fleetCount: number;
  catalogCount: number;
  shipName: string;
  setShipName: (v: string) => void;
  selectedShip: FleetShip | null;
  budget: string;
  setBudget: (v: string) => void;
  system: string;
  setSystem: (v: string) => void;
  prices: PricesStatus | null;
};

// Convoi actif : l'état qui relie Trouver → Charger → Naviguer → Vendre.
type ActiveConvoy = { route: CargoRoute; leg: number; shipName: string; cargoScu: number };

// ── Barre de contexte : les 3 « slots » partagés, toujours visibles ──
function ContextBar({ ctx }: { ctx: CargoCtx }) {
  const { t } = ctx;
  const cap = ctx.selectedShip?.cargoScu ?? null;
  const fresh = ctx.prices?.freshestTimestamp ?? null;
  const freshOk = priceFresh(fresh) ?? false;
  return (
    <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[var(--accent)]/[0.06] to-transparent p-3.5 lg:grid-cols-[auto_1fr_auto]">
      <span className="text-[9.5px] font-semibold uppercase leading-tight tracking-[0.16em] text-white/40">
        Contexte<br />du convoi
      </span>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Vaisseau + capacité */}
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent2,#8b5cf6)]">
            <Rocket className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Dropdown
                value={ctx.shipName}
                onChange={ctx.setShipName}
                ariaLabel={t("cargo.form.ship")}
                buttonClassName="text-sm font-bold text-white"
                className="w-48"
                options={ctx.ships.map((s) => ({
                  value: s.name,
                  label: `${s.name}${s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}`,
                }))}
              />
              {cap != null && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-300">
                  {cap} SCU
                </span>
              )}
            </div>
            <div className="mt-0.5 flex gap-1">
              <button
                type="button"
                onClick={() => ctx.switchGroup("fleet")}
                className={`text-[10.5px] ${ctx.group === "fleet" ? "text-[var(--accent)]" : "text-white/40 hover:text-white/70"}`}
              >
                {t("cargo.form.groupFleet")} ({ctx.fleetCount})
              </button>
              <span className="text-[10.5px] text-white/20">·</span>
              <button
                type="button"
                onClick={() => ctx.switchGroup("all")}
                className={`text-[10.5px] ${ctx.group === "all" ? "text-[var(--accent)]" : "text-white/40 hover:text-white/70"}`}
              >
                {t("cargo.form.groupAll")} ({ctx.catalogCount})
              </button>
            </div>
          </div>
        </div>
        {/* Départ (système) */}
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent2,#8b5cf6)]">
            <Navigation className="h-4 w-4" />
          </span>
          <div>
            <Dropdown
              value={ctx.system}
              onChange={ctx.setSystem}
              ariaLabel={t("cargo.form.system")}
              buttonClassName="text-sm font-bold text-white"
              className="w-36"
              options={[
                { value: "", label: t("cargo.form.systemAll") },
                ...SYSTEMS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
              ]}
            />
            <div className="mt-0.5 text-[10.5px] text-white/40">{t("cargo.form.system")}</div>
          </div>
        </div>
        {/* Budget */}
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent2,#8b5cf6)]">
            <Coins className="h-4 w-4" />
          </span>
          <div>
            <input
              type="number"
              min={0}
              value={ctx.budget}
              onChange={(e) => ctx.setBudget(e.target.value)}
              className="w-32 bg-transparent text-sm font-bold tabular-nums text-white focus:outline-none"
            />
            <div className="mt-0.5 text-[10.5px] text-white/40">{t("cargo.form.budget")} · aUEC</div>
          </div>
        </div>
      </div>
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[11.5px] text-white/55">
        <span className={`h-[7px] w-[7px] rounded-full ${freshOk ? "bg-emerald-400" : "bg-amber-400"}`} style={{ boxShadow: `0 0 8px ${freshOk ? "#2ee9a5" : "#f59e0b"}` }} />
        {t("cargo.form.prices")} · {relativeAge(fresh, t)}
      </span>
    </div>
  );
}

// ── Rail : les 4 outils comme un FLUX (01→04), plus des onglets isolés ──
function ToolRail({ tab, setTab, t }: { tab: string; setTab: (v: "single" | "loop" | "gps" | "grid") => void; t: TFunction }) {
  const steps = [
    { k: "single", n: "01", short: t("cargo.railFind"), Icon: Search },
    { k: "loop", n: "02", short: t("cargo.railLoop"), Icon: Repeat },
    { k: "gps", n: "03", short: t("cargo.railGps"), Icon: Navigation },
    { k: "grid", n: "04", short: t("cargo.railGrid"), Icon: Box },
  ] as const;
  return (
    <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-2 lg:w-[84px] lg:flex-col lg:items-center lg:overflow-visible">
      {steps.map((s, i) => {
        const on = tab === s.k;
        return (
          <div key={s.k} className="flex flex-col items-center lg:w-full">
            <button
              type="button"
              onClick={() => setTab(s.k)}
              className={`relative flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                on ? "text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              <span className="absolute right-2 top-1.5 text-[8px] tabular-nums text-white/25">{s.n}</span>
              <span
                className={`grid h-9 w-9 place-items-center rounded-xl border transition-colors ${
                  on
                    ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.18] text-[var(--accent2,#8b5cf6)]"
                    : "border-transparent"
                }`}
                style={on ? { boxShadow: "0 0 20px -4px var(--accent)" } : undefined}
              >
                <s.Icon className="h-[18px] w-[18px]" />
              </span>
              {s.short}
            </button>
            {i < steps.length - 1 && <span className="hidden h-3 w-0.5 bg-gradient-to-b from-white/10 to-transparent lg:block" />}
          </div>
        );
      })}
    </nav>
  );
}

// ── Convoi actif : barre basse persistante, relie les outils ──
function ConvoyStrip({ convoy, onAdvance, onClose, t }: { convoy: ActiveConvoy; onAdvance: () => void; onClose: () => void; t: TFunction }) {
  const r = convoy.route;
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const legs = [
    { t: t("cargo.convoy.loaded"), s: from },
    { t: t("cargo.convoy.transit"), s: `${r.commodity} → ${to}` },
    { t: t("cargo.convoy.sell"), s: to },
  ];
  const fillPct = convoy.cargoScu > 0 ? Math.min(100, Math.round((r.quantityScu / convoy.cargoScu) * 100)) : 100;
  const isLast = convoy.leg >= legs.length - 1;
  return (
    <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-2xl border border-emerald-400/25 bg-gradient-to-b from-emerald-400/[0.07] to-black/20 px-4 py-3 lg:grid-cols-[auto_1fr_auto_auto]">
      <span className="flex items-center gap-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px #2ee9a5" }} />
        {t("cargo.convoy.active")}
      </span>
      <div className="flex min-w-0 items-center">
        {legs.map((lg, i) => {
          const done = i < convoy.leg;
          const now = i === convoy.leg;
          return (
            <div key={i} className="flex min-w-0 flex-1 items-center">
              <span
                className={`grid h-6 w-6 flex-none place-items-center rounded-full border text-[11px] font-bold tabular-nums ${
                  done
                    ? "border-emerald-400/50 bg-emerald-400/20 text-emerald-300"
                    : now
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-white/15 text-white/40"
                }`}
                style={now ? { boxShadow: "0 0 14px -2px var(--accent)" } : undefined}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="ml-2 min-w-0">
                <span className="block truncate text-[11.5px] font-semibold text-white">{lg.t}</span>
                <span className="block truncate text-[10px] text-white/45">{lg.s}</span>
              </span>
              {i < legs.length - 1 && <span className={`mx-3 h-0.5 flex-1 rounded ${done ? "bg-emerald-400/45" : "bg-white/10"}`} />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 whitespace-nowrap text-[11px] tabular-nums text-white/55">
        <span className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent2,#8b5cf6)]" style={{ width: `${fillPct}%` }} />
        </span>
        <span className="text-white/75">{fmt(r.quantityScu)}/{fmt(convoy.cargoScu)} SCU</span>
      </div>
      <div className="flex items-center gap-2">
        {isLast ? (
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-[13px] font-bold text-[#04231a]">
            <Check className="h-4 w-4" /> {t("cargo.convoy.finish")}
          </button>
        ) : (
          <button type="button" onClick={onAdvance} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-[13px] font-bold text-[#04231a]">
            {t("cargo.convoy.next")} <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={t("cargo.convoy.abort")} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/40 hover:text-white/80">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Carte de route (cockpit) : commodité + chemin + aide décision + profit/min + Démarrer ──
function RouteCard({ r, rank, selected, highlightBest, t, onSelect, onStart }: {
  r: CargoRoute; rank: number; selected: boolean; highlightBest: boolean; t: TFunction; onSelect: () => void; onStart: () => void;
}) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const best = highlightBest && rank === 1;
  const fresh = priceFresh(r.priceTimestamp);
  return (
    <article
      onClick={onSelect}
      className={`grid cursor-pointer grid-cols-[1fr_auto] gap-x-4 gap-y-3 rounded-2xl border p-4 transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/[0.06]"
          : best
            ? "border-emerald-400/40 bg-gradient-to-r from-emerald-400/[0.07] to-transparent hover:border-emerald-400/60"
            : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
      style={selected ? { boxShadow: "0 0 0 1px var(--accent)" } : undefined}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-[17px] font-bold capitalize text-white">{r.commodity}</span>
          {best && (
            <span className="rounded-md bg-emerald-400 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-[#04231a]">
              {t("cargo.bestRoute")}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/60">
          <span className="font-medium capitalize text-white/85">{from}</span>
          <ArrowRight className="h-3.5 w-3.5 text-[var(--accent2,#8b5cf6)]" />
          <span className="font-medium capitalize text-white/85">{to}</span>
          {r.jumps != null && <span className="text-white/35">· {t("cargo.jumpsN", { n: r.jumps })}</span>}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1 text-[11px] tabular-nums text-white/60">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent2,#8b5cf6)]" style={{ width: `${r.quantityScu}%` }} />
            </span>
            {fmt(r.quantityScu)} SCU
          </span>
          {r.timeMinutes != null && (
            <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[11px] tabular-nums text-white/60">~{r.timeMinutes.toFixed(0)} {t("cargo.unit.min")}</span>
          )}
          {fresh != null && (
            <span className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${fresh ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
              {t("cargo.priceAge", { age: relativeAge(r.priceTimestamp, t) })}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-2">
        <div className="text-right">
          <div className="text-[21px] font-semibold leading-none tabular-nums text-emerald-400">+{fmt(r.profit)}</div>
          {r.profitPerMinute != null && (
            <div className="mt-1 text-[11px] tabular-nums text-white/40">{fmt(r.profitPerMinute)} {t("cargo.unit.perMin")}</div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors ${
            best
              ? "border-emerald-400/50 bg-emerald-400/[0.16] text-emerald-200 hover:bg-emerald-400/25"
              : "border-[var(--accent)]/50 bg-[var(--accent)]/[0.16] text-[#d5d6ff] hover:bg-[var(--accent)]/25"
          }`}
        >
          {t("cargo.convoy.start")} <Play className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

// ── Mini-carte du trajet (SVG décoratif, DA app) ──
function RouteMap({ from, to }: { from: string; to: string }) {
  return (
    <div className="relative h-[190px] overflow-hidden rounded-t-2xl border-b border-white/10" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(99,102,241,.12), transparent 70%)" }}>
      <svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="lane2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#2ee9a5" />
          </linearGradient>
        </defs>
        <g fill="#fff" opacity="0.5">
          <circle cx="46" cy="30" r="1.2" /><circle cx="140" cy="55" r="1" /><circle cx="320" cy="34" r="1.4" /><circle cx="250" cy="130" r="1" /><circle cx="80" cy="150" r="1.2" /><circle cx="360" cy="150" r="1" />
        </g>
        <path d="M70 140 C 150 100, 210 125, 320 55" fill="none" stroke="url(#lane2)" strokeWidth="2.2" strokeDasharray="1 7" strokeLinecap="round" />
        <circle cx="70" cy="140" r="15" fill="rgba(245,158,11,.16)" stroke="#f59e0b" strokeWidth="1.1" /><circle cx="70" cy="140" r="4" fill="#f59e0b" />
        <circle cx="320" cy="55" r="18" fill="rgba(46,233,165,.16)" stroke="#2ee9a5" strokeWidth="1.1" /><circle cx="320" cy="55" r="4.5" fill="#2ee9a5" />
        <circle cx="196" cy="107" r="4.5" fill="#fff" /><circle cx="196" cy="107" r="9" fill="none" stroke="#fff" strokeOpacity="0.4" />
      </svg>
      <span className="absolute left-3.5 top-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
        <MapPin className="h-3 w-3 text-amber-400" /> <span className="capitalize text-white/80">{from}</span>
        <ArrowRight className="h-3 w-3" /> <span className="capitalize text-emerald-300">{to}</span>
      </span>
    </div>
  );
}

function PlannerTab({ ctx, onLoadToHold, onStartConvoy }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
  onStartConvoy: (route: CargoRoute) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Route ciblée depuis le widget dashboard : { shipName, commodity, fromLocation, toLocation }.
  // On sélectionne ce vaisseau, on calcule, et on ouvre la modale de la route correspondante.
  const location = useLocation();
  const pendingRoute =
    (location.state as { route?: PendingRoute } | null)?.route ?? null;
  const appliedRef = useRef(false);

  // Contexte partagé (vaisseau · budget · système · flotte · prix) — remonté au wrapper cockpit.
  const { ships, shipName, budget, system, prices, setShipName } = ctx;

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<FindRoutesResult | null>(null);
  const [routeSort, setRouteSort] = usePersistentState<RouteSort>("cargo.single.sort", "profit");
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.single.route", null);
  const [modalRoute, setModalRoute] = useState<CargoRoute | null>(null);

  const hasPrices = (prices?.rows ?? 0) > 0;

  // Overlay en jeu : pousse la route simple choisie (1 étape).
  useEffect(() => {
    pushOverlayRoute(
      selectedRoute ? { source: "single", shipName, steps: [legToStep(selectedRoute)] } : null,
    );
  }, [selectedRoute, shipName]);

  async function calculate(opts?: { shipNameOverride?: string; openRoute?: PendingRoute }) {
    setError(null);
    setResult(null);
    const sn = opts?.shipNameOverride ?? shipName;
    const investment = Number(budget);
    if (!sn) {
      setError(t("cargo.err.noShip"));
      return;
    }
    if (!Number.isFinite(investment) || investment <= 0) {
      setError(t("cargo.err.budget"));
      return;
    }
    setCalculating(true);
    try {
      const r = await invoke<FindRoutesResult>("find_cargo_routes", {
        shipName: sn,
        investment,
        system: system || null,
        limit: 50,
      });
      setResult(r);
      // Pré-ouverture (depuis le widget) : sélectionne la route correspondante.
      if (opts?.openRoute) {
        const tgt = opts.openRoute;
        const match = r.routes.find(
          (x) =>
            x.commodity === tgt.commodity &&
            x.fromLocation === tgt.fromLocation &&
            x.toLocation === tgt.toLocation,
        );
        if (match) setSelectedRoute(match);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

  // Arrivée depuis le widget « Top routes » : dès que la flotte est prête, sélectionne le
  // vaisseau cible, calcule, puis sélectionne la route. Une seule fois.
  useEffect(() => {
    if (appliedRef.current || !pendingRoute || ships.length === 0) return;
    appliedRef.current = true;
    setShipName(pendingRoute.shipName);
    void calculate({ shipNameOverride: pendingRoute.shipName, openRoute: pendingRoute });
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoute, ships.length]);

  const sorted = result ? sortRoutes(result.routes, routeSort) : [];
  const detail: CargoRoute | null = selectedRoute ?? sorted[0] ?? null;
  const highlightBest = routeSort !== "time";

  return (
    <>
      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {/* Barre d'action : calculer + tri */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void calculate()}
          disabled={calculating || !hasPrices || !shipName}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
        </button>
        {!hasPrices && (
          <button type="button" onClick={() => navigate("/settings")} className="rounded-xl border border-[var(--accent)]/50 px-3 py-2.5 text-xs text-[var(--accent)] hover:bg-white/5">
            {t("cargo.empty.noPricesCta")}
          </button>
        )}
        {result && result.routes.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
            {t("cargo.sortLabel")}
            <Dropdown
              value={routeSort}
              onChange={(v) => setRouteSort(v as RouteSort)}
              buttonClassName="text-xs text-white/80"
              className="w-40"
              options={[
                { value: "profit", label: t("cargo.sortProfit") },
                { value: "ppm", label: t("cargo.sortPpm") },
                { value: "time", label: t("cargo.sortTime") },
              ]}
            />
          </div>
        )}
      </div>

      {/* Cockpit : cartes de route (gauche) + carte + détail (droite) */}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
            {result ? t("cargo.routesCount", { n: result.routes.length }) : t("cargo.results.title")}
          </span>
          {!result ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          ) : result.routes.length === 0 ? (
            <p className="rounded-2xl border border-white/10 py-12 text-center text-sm text-white/50">{t("cargo.results.none")}</p>
          ) : (
            sorted.map((r, i) => (
              <RouteCard
                key={i}
                r={r}
                rank={i + 1}
                highlightBest={highlightBest}
                selected={detail === r}
                t={t}
                onSelect={() => setSelectedRoute(r)}
                onStart={() => onStartConvoy(r)}
              />
            ))
          )}
        </div>

        <aside className="self-start overflow-hidden rounded-2xl border border-white/10 bg-black/15">
          {detail ? (
            <>
              <RouteMap from={detail.fromName ?? detail.fromLocation} to={detail.toName ?? detail.toLocation} />
              <div className="flex flex-col gap-3.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[18px] font-bold capitalize text-white">{detail.commodity}</div>
                    <div className="mt-0.5 text-[12px] text-white/45">
                      <span className="capitalize">{detail.fromName ?? detail.fromLocation}</span> → <span className="capitalize">{detail.toName ?? detail.toLocation}</span>
                      {detail.jumps != null ? ` · ${t("cargo.jumpsN", { n: detail.jumps })}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[20px] font-semibold leading-none tabular-nums text-emerald-400">+{fmt(detail.profit)}</div>
                    <div className="mt-1 text-[10px] text-white/40">{fmt(detail.quantityScu)} SCU</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    [t("cargo.results.buy"), fmt(detail.buyPrice), false],
                    [t("cargo.results.sell"), fmt(detail.sellPrice), true],
                    [t("cargo.results.margin"), fmt(detail.marginUnit), false],
                    [t("cargo.results.time"), detail.timeMinutes != null ? `~${detail.timeMinutes.toFixed(0)} ${t("cargo.unit.min")}` : "—", false],
                  ] as const).map(([k, v, acc], i) => (
                    <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-white/40">{k}</div>
                      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${acc ? "text-emerald-400" : "text-white/90"}`}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onStartConvoy(detail)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    {t("cargo.convoy.start")} <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToHold(shipName, detail.commodity, detail.quantityScu)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] font-medium text-white/70 hover:bg-white/10"
                  >
                    <Box className="h-4 w-4" /> {t("cargo.tabGrid")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalRoute(detail)}
                    aria-label={t("cargo.results.detailsAria")}
                    className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/10"
                  >
                    <PackageSearch className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          )}
        </aside>
      </div>

      {modalRoute && <RouteDetailsModal route={modalRoute} onClose={() => setModalRoute(null)} />}
    </>
  );
}

/* ── Onglet : Planificateur de BOUCLE (chaîne de routes rentables) ── */
function LoopPlannerTab({ ctx, onLoadToHold }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Vaisseau · budget · système · prix viennent du contexte partagé (barre de convoi).
  const { shipName, budget, system, prices } = ctx;

  const [commodities, setCommodities] = useState<string[]>([]);
  const [resource, setResource] = usePersistentState<string>("cargo.loop.resource", "");
  const [mode, setMode] = usePersistentState<"closed" | "open">("cargo.loop.mode", "closed");
  const [maxPoints, setMaxPoints] = usePersistentState<number>("cargo.loop.maxPoints", 4);
  const [unlimited, setUnlimited] = usePersistentState<boolean>("cargo.loop.unlimited", false);

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.loop.route", null);

  const hasPrices = (prices?.rows ?? 0) > 0;

  // Overlay en jeu : pousse la boucle calculée (toutes ses étapes).
  useEffect(() => {
    pushOverlayRoute(
      result && result.legs.length > 0
        ? { source: "loop", shipName, steps: result.legs.map(legToStep) }
        : null,
    );
  }, [result, shipName]);

  // Marchandises (le reste — vaisseau/prix — vient du contexte partagé).
  useEffect(() => {
    let alive = true;
    invoke<string[]>("get_cargo_commodities")
      .then((comms) => {
        if (!alive) return;
        setCommodities(comms);
        if (!resource && comms.length > 0) setResource(comms[0]);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function calculate() {
    setError(null);
    setResult(null);
    const inv = Number(budget);
    if (!resource) {
      setError(t("cargo.loop.errNoResource"));
      return;
    }
    if (!shipName) {
      setError(t("cargo.err.noShip"));
      return;
    }
    if (!Number.isFinite(inv) || inv <= 0) {
      setError(t("cargo.err.budget"));
      return;
    }
    setCalculating(true);
    try {
      const r = await invoke<LoopResult>("find_cargo_loop", {
        resource,
        shipName,
        budget: inv,
        mode,
        maxHops: unlimited ? null : maxPoints,
        system: system || null,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

  return (
    <>
      {error && (
        <p className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Paramètres SPÉCIFIQUES à la boucle : ressource · mode · nb de points.
          Vaisseau · budget · système viennent du contexte de convoi partagé (barre du haut). */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.resource")}</span>
            <Dropdown
              value={resource}
              onChange={setResource}
              ariaLabel={t("cargo.loop.resource")}
              searchable
              options={commodities.map((c) => ({ value: c, label: c }))}
            />
          </label>
          <div>
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.mode")}</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-1">
              {(["closed", "open"] as const).map((mk) => (
                <button
                  key={mk}
                  type="button"
                  onClick={() => setMode(mk)}
                  title={t(mk === "closed" ? "cargo.loop.modeClosedDesc" : "cargo.loop.modeOpenDesc")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                    mode === mk ? "bg-[var(--accent)] text-white" : "text-white/60 hover:bg-white/10"
                  }`}
                >
                  {mk === "closed" ? <RotateCcw className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {t(mk === "closed" ? "cargo.loop.modeClosed" : "cargo.loop.modeOpen")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.pointsMax")}</span>
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={1}
                max={10}
                value={maxPoints}
                disabled={unlimited}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-40"
              />
              <span className="w-6 text-center text-lg font-medium tabular-nums text-[var(--accent)]">{unlimited ? "∞" : maxPoints}</span>
              <button
                type="button"
                onClick={() => setUnlimited((u) => !u)}
                title={t("cargo.loop.unlimited")}
                aria-pressed={unlimited}
                className={`grid h-8 w-8 flex-none place-items-center rounded-lg border transition-colors ${
                  unlimited ? "border-[var(--accent)]/45 bg-[var(--accent)]/[0.16] text-[var(--accent)]" : "border-white/10 text-white/50 hover:bg-white/10"
                }`}
              >
                <InfinityIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void calculate()}
            disabled={calculating || !hasPrices || !shipName}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
          </button>
          {!hasPrices && (
            <button type="button" onClick={() => navigate("/settings")} className="rounded-xl border border-[var(--accent)]/50 px-3 py-2.5 text-xs text-[var(--accent)] hover:bg-white/5">
              {t("cargo.empty.noPricesCta")}
            </button>
          )}
        </div>
      </div>

      {/* Résultat : étapes de la boucle (gauche) + bilan en tuiles (droite) */}
      <div className="mt-4">
        {!result ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
            <Truck className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("cargo.loop.resultsEmpty")}</p>
          </div>
        ) : result.legs.length === 0 ? (
          <p className="rounded-2xl border border-white/10 py-12 text-center text-sm text-white/50">
            {result.note ?? t(mode === "closed" ? "cargo.loop.emptyClosed" : "cargo.loop.emptyOpen")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
            <div className="flex min-w-0 flex-col gap-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                {result.closed ? t("cargo.loop.closedRecap", { loc: result.startLocation }) : t("cargo.loop.openRecap", { loc: result.endLocation })}
              </span>
              {result.legs.map((r, i) => (
                <RouteRow
                  key={i}
                  r={r}
                  rank={i + 1}
                  t={t}
                  onClick={() => setSelectedRoute(r)}
                  onLoad={() => onLoadToHold(shipName, r.commodity, r.quantityScu)}
                />
              ))}
            </div>
            <aside className="flex flex-col gap-3 self-start rounded-2xl border border-white/10 bg-black/15 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{t("cargo.loop.resultTitle")}</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.totalProfit")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-400">+{fmt(result.totalProfit)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.totalTime")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.totalTimeMinutes != null ? `${result.totalTimeMinutes.toFixed(0)} ${t("cargo.unit.min")}` : "—"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.hops")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.hops}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.legs")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.legs.length}</div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {selectedRoute && (
        <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />
      )}
    </>
  );
}

/* ── Onglet : GPS trading (navigation pas-à-pas pilotée par l'utilisateur) ── */
function AffluenceBadge({ level, t }: { level: Affluence; t: TFunction }) {
  const map: Record<Affluence, { label: string; cls: string }> = {
    low: { label: t("cargo.gps.affLow"), cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
    medium: { label: t("cargo.gps.affMedium"), cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
    high: { label: t("cargo.gps.affHigh"), cls: "border-red-400/40 bg-red-400/10 text-red-300" },
  };
  const m = map[level];
  return (
    <span
      title={t("cargo.gps.affTitle")}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}
    >
      {t("cargo.gps.affEstimated")} · {m.label}
    </span>
  );
}

/* Badge carburant quantique d'un leg : coût en SCU. Passe au rouge + « ravitaillement » quand
   `over` (le leg dépasse le carburant restant sur le trajet cumulé). Le caller ne le rend que
   si l'autonomie du vaisseau est connue. */
function FuelBadge({ fuelScu, over, t }: { fuelScu: number | null; over?: boolean; t: TFunction }) {
  return (
    <span
      title={over ? t("cargo.gps.refuelTitle") : t("cargo.gps.fuelTitle")}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        over ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"
      }`}
    >
      <Fuel className="h-3 w-3" />
      {fuelScu != null ? `${fuelScu.toFixed(2)} SCU` : "—"}
      {over && ` · ${t("cargo.gps.refuelNeeded")}`}
    </span>
  );
}

function GpsTradingTab({ ctx, onLoadToHold }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Vaisseau · système · flotte · prix viennent du contexte de convoi partagé (barre du haut).
  const { shipName, setShipName, system, setSystem, ships, prices } = ctx;

  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graph, setGraph] = useState<TradeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État de navigation (100 % front) : départ + étapes confirmées — persisté.
  const [startKey, setStartKey] = usePersistentState<string>("cargo.gps.startKey", "");
  const [paramsOpen, setParamsOpen] = usePersistentState("cargo.gps.paramsOpen", true);
  const [steps, setSteps] = usePersistentState<GpsStep[]>("cargo.gps.steps", []);
  const [expanded, setExpanded] = usePersistentState<string | null>("cargo.gps.expanded", null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.gps.route", null);
  const [showMap, setShowMap] = usePersistentState("cargo.gps.showMap", false);

  // Phase 1.2 — lieu détecté en jeu (Game.log) : nourrit le choix du départ.
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<string | null>("get_current_location")
      .then((l) => {
        if (alive) setDetectedLocation(l);
      })
      .catch(() => {});
    const pending = listen<{ location: string }>("gamelog:location", (e) => {
      setDetectedLocation(e.payload?.location ?? null);
    });
    return () => {
      alive = false;
      void pending.then((un) => un());
    };
  }, []);

  const hasPrices = (prices?.rows ?? 0) > 0;

  function resetTrip() {
    setStartKey("");
    setSteps([]);
    setExpanded(null);
  }

  async function loadGraph() {
    setError(null);
    setGraph(null);
    resetTrip();
    if (!shipName) {
      setError(t("cargo.err.noShip"));
      return;
    }
    setLoadingGraph(true);
    try {
      const g = await invoke<TradeGraph>("get_trade_graph", {
        shipName,
        system: system || null,
      });
      setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingGraph(false);
    }
  }

  // Restauration : si un trajet GPS a été persisté (vaisseau + départ/étapes), on recharge le
  // graphe au montage SANS réinitialiser le trajet (loadGraph normal appelle resetTrip).
  // PAS de garde par ref : le double-effet StrictMode laisserait `loadingGraph` bloqué à true
  // (le 1er passage est annulé par `alive`, le 2e sortirait tôt). Le garde `alive` suffit :
  // le dernier passage monté termine le chargement.
  useEffect(() => {
    if (!shipName || (!startKey && steps.length === 0)) return;
    let alive = true;
    setLoadingGraph(true);
    invoke<TradeGraph>("get_trade_graph", { shipName, system: system || null })
      .then((g) => {
        if (alive) setGraph(g);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingGraph(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1.2 — rapproche le lieu détecté (code de zone du Game.log, ex. « Stanton_Hurston »)
  // d'un nœud du graphe par recouvrement de jetons. Best-effort : null si pas de correspondance.
  const detectedMatch = useMemo(() => {
    if (!detectedLocation || !graph) return null;
    const tokens = (s: string) =>
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    const want = tokens(detectedLocation);
    if (want.length === 0) return null;
    let best: { key: string; name: string; score: number } | null = null;
    for (const l of graph.locations) {
      const hay = tokens(`${l.name} ${l.system ?? ""} ${l.key}`);
      const score = want.filter((w) => hay.some((h) => h.includes(w) || w.includes(h))).length;
      if (score > 0 && (!best || score > best.score)) best = { key: l.key, name: l.name, score };
    }
    return best;
  }, [detectedLocation, graph]);

  // Carrefour courant = dernier lieu d'arrivée, sinon le lieu de départ.
  const current = steps.length > 0 ? steps[steps.length - 1].leg.toKey : startKey;

  // Overlay en jeu : pousse le TRAJET confirmé (les étapes), pas la modale de détails.
  useEffect(() => {
    pushOverlayRoute(
      steps.length > 0
        ? { source: "gps", shipName, rangeGm: graph?.quantumRangeGm ?? null, steps: steps.map((s) => legToStep(s.leg)) }
        : null,
    );
  }, [steps, shipName, graph]);
  const cumulProfit = steps.reduce((a, s) => a + s.leg.profit, 0);
  const allTimed = steps.length > 0 && steps.every((s) => s.leg.timeMinutes != null);
  const cumulTime = allTimed ? steps.reduce((a, s) => a + (s.leg.timeMinutes ?? 0), 0) : null;

  // ── Carburant quantique / autonomie ──
  // L'API Wiki donne l'autonomie pleine charge (Gm) et la capacité réservoir (SCU). On suit la
  // consommation CUMULÉE depuis le départ, SANS ravitaillement intermédiaire : dès que la
  // distance cumulée dépasse l'autonomie, un arrêt ravitaillement est nécessaire à ce point.
  const rangeGm = graph?.quantumRangeGm ?? null;
  const tankScu = graph?.quantumFuelScu ?? null;
  const hasFuelData = rangeGm != null && rangeGm > 0;
  const cumulDist = steps.reduce((a, s) => a + (s.leg.distanceGm ?? 0), 0);
  const cumulFuel = steps.reduce((a, s) => a + (s.leg.fuelScu ?? 0), 0);
  const remainingRange = hasFuelData ? (rangeGm as number) - cumulDist : null; // Gm avant panne
  const overRange = remainingRange != null && remainingRange < 0;
  // 1re étape où la distance cumulée dépasse l'autonomie = là où l'on tombe en panne sèche.
  const refuelAtStep = (() => {
    if (!hasFuelData) return -1;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].leg.distanceGm ?? 0;
      if (acc > (rangeGm as number)) return i;
    }
    return -1;
  })();
  // Leg candidat (depuis le carrefour courant) infaisable avec le carburant restant.
  const legUnreachable = (leg: GpsLeg) =>
    hasFuelData && leg.distanceGm != null && (remainingRange as number) < leg.distanceGm;

  function nameOf(key: string): string {
    return graph?.locations.find((l) => l.key === key)?.name ?? key;
  }

  // Fil d'Ariane : départ + chaque lieu d'arrivée confirmé.
  const crumbs: { key: string; name: string }[] = startKey
    ? [
        { key: startKey, name: nameOf(startKey) },
        ...steps.map((s) => ({ key: s.leg.toKey, name: s.leg.toName ?? s.leg.toLocation })),
      ]
    : [];
  const currentName = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : "";

  // Marche arrière : clic sur un nœud du fil d'Ariane → tronque à cette position.
  function goToCrumb(idx: number) {
    setSteps((prev) => prev.slice(0, idx));
    setExpanded(null);
  }

  function confirmLeg(leg: GpsLeg) {
    setSteps((prev) => [...prev, { leg }]);
    setExpanded(null);
  }

  // Vue carrefour : denrées achetables ici + leurs reventes (legs groupés par denrée).
  const buyable = (graph && current ? graph.buyableAt[current] : undefined) ?? [];
  const legsHere = (graph && current ? graph.legsFrom[current] : undefined) ?? [];
  const legsByCommodity = useMemo(() => {
    const m = new Map<string, GpsLeg[]>();
    for (const l of legsHere) {
      const arr = m.get(l.commodity);
      if (arr) arr.push(l);
      else m.set(l.commodity, [l]);
    }
    return m;
  }, [legsHere]);

  // Lignes triées : denrées rentables d'abord (par potentiel), puis sans revente, ruptures en fin.
  const rows = useMemo(() => {
    const list = buyable.map((item) => ({ item, options: legsByCommodity.get(item.commodity) ?? [] }));
    const score = (r: (typeof list)[number]) => {
      if (r.item.outOfStock) return -1e15;
      const best = r.options[0];
      if (!best) return -1e14;
      return best.profitPerMinute ?? best.profit;
    };
    return list.sort((a, b) => score(b) - score(a));
  }, [buyable, legsByCommodity]);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/60">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: hasPrices ? "rgb(52 211 153)" : "var(--accent)" }}
            aria-hidden="true"
          />
          <span>
            {hasPrices
              ? t("cargo.pricesFresh", { age: relativeAge(prices?.freshestTimestamp ?? null, t) })
              : t("cargo.pricesNone")}
          </span>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-5">
        {/* Paramètres (panneau en haut) : vaisseau + système + chargement du graphe + départ */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <button
            type="button"
            onClick={() => setParamsOpen((o) => !o)}
            className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/50 transition-colors hover:text-white/70"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${paramsOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
            {t("cargo.form.title")}
          </button>

          {!paramsOpen ? (
            <p className="text-xs text-white/50">
              {(shipName || "—") + " · " + (system ? system.charAt(0).toUpperCase() + system.slice(1) : t("cargo.form.systemAll"))}
            </p>
          ) : (
          <>
          <p className="mb-4 text-[11px] leading-relaxed text-white/40">{t("cargo.gps.intro")}</p>

          <>
              <div className="grid items-start gap-x-4 gap-y-1 md:grid-cols-2">
              <Field label={t("cargo.form.ship")}>
                <Dropdown
                  value={shipName}
                  onChange={setShipName}
                  ariaLabel={t("cargo.form.ship")}
                  options={ships.map((s) => ({
                    value: s.name,
                    label: `${s.name}${s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}`,
                  }))}
                />
              </Field>

              <Field label={t("cargo.form.system")}>
                <Dropdown
                  value={system}
                  onChange={setSystem}
                  ariaLabel={t("cargo.form.system")}
                  options={[
                    { value: "", label: t("cargo.form.systemAll") },
                    ...SYSTEMS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                  ]}
                />
              </Field>
              </div>

              <button
                type="button"
                onClick={() => void loadGraph()}
                disabled={loadingGraph || !hasPrices || !shipName}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingGraph ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                {loadingGraph ? t("cargo.gps.loadingGraph") : t("cargo.gps.loadGraph")}
              </button>

              {graph && (
                <Field label={t("cargo.gps.start")}>
                  <Dropdown
                    value={startKey}
                    onChange={(v) => {
                      setStartKey(v);
                      setSteps([]);
                      setExpanded(null);
                      setParamsOpen(false);
                    }}
                    ariaLabel={t("cargo.gps.start")}
                    searchable
                    placeholder={t("cargo.gps.pickStart")}
                    options={graph.locations.map((l) => ({
                      value: l.key,
                      label: l.system ? `${l.name} · ${l.system}` : l.name,
                    }))}
                  />
                  {detectedLocation && (
                    <div className="mt-1.5 text-xs text-white/50">
                      📍 {t("cargo.gps.detectedLocation", { location: detectedLocation })}
                      {detectedMatch && detectedMatch.key !== startKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setStartKey(detectedMatch.key);
                            setSteps([]);
                            setExpanded(null);
                            setParamsOpen(false);
                          }}
                          className="ml-2 rounded border border-[var(--accent)]/40 px-2 py-0.5 text-[var(--accent)] transition-colors hover:bg-white/5"
                        >
                          {t("cargo.gps.useDetected", { name: detectedMatch.name })}
                        </button>
                      )}
                    </div>
                  )}
                </Field>
              )}

              {!hasPrices && (
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="mt-3 w-full rounded-lg border border-[var(--accent)]/50 px-3 py-2 text-xs text-[var(--accent)] hover:bg-white/5"
                >
                  {t("cargo.empty.noPricesCta")}
                </button>
              )}
            </>
          </>
          )}
        </div>

        {/* Navigation : trajet + carrefour courant */}
        <div className="flex flex-col gap-5">
          {/* Bandeau « Mon trajet » + breadcrumb */}
          {graph && startKey && (
            <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                    {t("cargo.gps.myRoute")}
                  </p>
                  {hasFuelData && (
                    <span
                      title={t("cargo.gps.autonomyTitle")}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
                    >
                      <Fuel className="h-3 w-3" />
                      {t("cargo.gps.autonomy")} {(rangeGm as number).toFixed(0)} Gm
                      {tankScu != null ? ` · ${t("cargo.gps.tank")} ${tankScu.toFixed(1)} SCU` : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMap(true)}
                    disabled={steps.length === 0}
                    title={t("cargo.gps.viewMap")}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
                  >
                    {t("cargo.gps.viewMap")}
                  </button>
                  <button
                    type="button"
                    onClick={resetTrip}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10"
                  >
                    {t("cargo.gps.reset")}
                  </button>
                </div>
              </div>

              {/* Fil d'Ariane cliquable (marche arrière) */}
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                {crumbs.map((c, i) => (
                  <span key={`${c.key}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />}
                    <button
                      type="button"
                      onClick={() => goToCrumb(i)}
                      className={`max-w-[180px] truncate rounded-md px-2 py-0.5 capitalize transition-colors ${
                        i === crumbs.length - 1
                          ? "bg-[var(--accent)]/20 font-semibold text-white"
                          : "text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {i === 0 ? `${t("cargo.gps.startAt")} · ${c.name}` : c.name}
                    </button>
                  </span>
                ))}
              </div>

              {steps.length === 0 ? (
                <p className="mt-3 text-[12px] text-white/50">{t("cargo.gps.emptyTrip")}</p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
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
                    <span>
                      {t("cargo.gps.steps")} <span className="text-white/80">{steps.length}</span>
                    </span>
                  </div>

                  {/* Jauge de carburant : distance cumulée vs autonomie pleine charge */}
                  {hasFuelData && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                        <span>
                          {t("cargo.gps.fuelUsed")}{" "}
                          <span className={overRange ? "font-semibold text-red-300" : "text-white/80"}>
                            {cumulDist.toFixed(0)}/{(rangeGm as number).toFixed(0)} Gm
                          </span>
                        </span>
                        <span className="text-sky-300">{cumulFuel.toFixed(2)} SCU</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (cumulDist / (rangeGm as number)) * 100)}%`,
                            background: overRange ? "rgb(248 113 113)" : "rgb(56 189 248)",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {refuelAtStep >= 0 && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[11px] text-red-300">
                      <Fuel className="h-3.5 w-3.5 shrink-0" />
                      {t("cargo.gps.refuelWarning", { n: refuelAtStep + 1 })}
                    </div>
                  )}

                  <div className="mt-3 flex flex-col gap-2">
                    {steps.map((s, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedRoute(s.leg)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedRoute(s.leg);
                          }
                        }}
                        className="cursor-pointer rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:border-white/20 hover:bg-white/5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-white/80">
                            <span className="text-[11px] font-semibold text-white/30">#{i + 1}</span>
                            <span className="truncate font-medium capitalize text-white">{s.leg.commodity}</span>
                            <span className="truncate capitalize text-white/50">
                              → {s.leg.toName ?? s.leg.toLocation}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {hasFuelData && (
                              <FuelBadge fuelScu={s.leg.fuelScu} over={i === refuelAtStep} t={t} />
                            )}
                            <span className="text-[13px] font-semibold text-emerald-400">+{fmt(s.leg.profit)}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onLoadToHold(shipName, s.leg.commodity, s.leg.quantityScu);
                              }}
                              title={t("cargo.loadToHold")}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
                            >
                              <Truck className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Carrefour courant */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            {!graph ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
                <Truck className="h-8 w-8 opacity-40" />
                <p className="text-sm">{t("cargo.gps.pickShipFirst")}</p>
              </div>
            ) : !startKey ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
                <PackageSearch className="h-8 w-8 opacity-40" />
                <p className="text-sm">{t("cargo.gps.noStart")}</p>
              </div>
            ) : (
              <>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
                  {t("cargo.gps.buyableHere")}
                </p>
                <p className="mb-4 text-sm font-semibold capitalize text-[var(--accent)]">
                  {t("cargo.gps.fromLocation", { loc: currentName })}
                </p>

                {rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/50">{t("cargo.gps.noBuyable")}</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {rows.map(({ item, options }) => {
                      const best = options[0];
                      const isOpen = expanded === item.commodity;
                      const others = options.slice(1);
                      if (item.outOfStock) {
                        return (
                          <div
                            key={item.commodity}
                            className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 opacity-50"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-medium capitalize text-white/60 line-through">
                                {item.commodity}
                              </span>
                              <span className="rounded-md border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                                {t("cargo.gps.outOfStock")}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={item.commodity}
                          className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                        >
                          <div
                            role={best ? "button" : undefined}
                            tabIndex={best ? 0 : undefined}
                            onClick={() => best && setExpanded(isOpen ? null : item.commodity)}
                            onKeyDown={(e) => {
                              if (best && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                setExpanded(isOpen ? null : item.commodity);
                              }
                            }}
                            className={best ? "cursor-pointer" : ""}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold capitalize text-white">
                                  {item.commodity}
                                </span>
                                <span className="shrink-0 text-[11px] text-white/40">
                                  {t("cargo.results.buy")} {fmt(item.buyPrice)} aUEC/SCU
                                </span>
                              </div>
                              {best && (
                                <span className="shrink-0 text-sm font-semibold text-emerald-400">
                                  +{fmt(best.profit)}
                                </span>
                              )}
                            </div>

                            {best ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/60">
                                <span className="text-[10px] uppercase tracking-wide text-white/30">
                                  {t("cargo.gps.bestResale")}
                                </span>
                                <span className="capitalize text-white/80">{best.toName ?? best.toLocation}</span>
                                <span className="text-white/40">·</span>
                                <span>
                                  {best.distanceGm != null ? `${best.distanceGm.toFixed(2)} Gm` : "—"} ·{" "}
                                  {best.timeMinutes != null
                                    ? `${best.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}`
                                    : "—"}
                                </span>
                                <AffluenceBadge level={best.affluence} t={t} />
                                {hasFuelData && <FuelBadge fuelScu={best.fuelScu} over={legUnreachable(best)} t={t} />}
                              </div>
                            ) : (
                              <p className="mt-1.5 text-[12px] text-white/40">{t("cargo.gps.noResale")}</p>
                            )}
                          </div>

                          {best && (
                            <div className="mt-2.5 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => confirmLeg(best)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                              >
                                {t("cargo.gps.confirm")}
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                              {others.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpanded(isOpen ? null : item.commodity)}
                                  className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10"
                                >
                                  {t("cargo.gps.otherResales", { n: others.length })}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Reventes alternatives dépliées */}
                          {isOpen && others.length > 0 && (
                            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
                              {others.map((opt, oi) => (
                                <div
                                  key={oi}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-[12px]"
                                >
                                  <div className="flex min-w-0 items-center gap-2 text-white/70">
                                    <span className="truncate capitalize">{opt.toName ?? opt.toLocation}</span>
                                    <span className="shrink-0 text-white/40">
                                      {opt.distanceGm != null ? `${opt.distanceGm.toFixed(2)} Gm` : "—"}
                                    </span>
                                    <AffluenceBadge level={opt.affluence} t={t} />
                                    {hasFuelData && <FuelBadge fuelScu={opt.fuelScu} over={legUnreachable(opt)} t={t} />}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span className="font-semibold text-emerald-400">+{fmt(opt.profit)}</span>
                                    <button
                                      type="button"
                                      onClick={() => confirmLeg(opt)}
                                      className="rounded-md bg-[var(--accent)]/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[var(--accent)]"
                                    >
                                      {t("cargo.gps.confirm")}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {selectedRoute && <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />}
      {showMap && graph && startKey && (
        <TripMapModal steps={steps} startKey={startKey} graph={graph} onClose={() => setShowMap(false)} />
      )}
    </>
  );
}

/* ── Wrapper : onglets Planificateur / Grille de soute ── */
// Demande de chargement transmise du planificateur vers la grille (nonce = re-déclenche).
export type LoadToHoldRequest = { shipName: string; commodity: string; scu: number; nonce: number };

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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-white/40">{label}</div>
      {children}
    </div>
  );
}

function RouteRow({
  r,
  rank,
  t,
  onClick,
  onLoad,
  highlightBest = false,
}: {
  r: CargoRoute;
  rank: number;
  t: TFunction;
  onClick: () => void;
  onLoad: () => void;
  // Surligne le rang 1 comme « meilleure » : pertinent pour une LISTE TRIÉE (Planificateur),
  // pas pour une séquence d'étapes (Boucle) → désactivé par défaut.
  highlightBest?: boolean;
}) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const dash = "—";
  const fresh = priceFresh(r.priceTimestamp);
  const best = highlightBest && rank === 1;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`w-full cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors ${
        best
          ? "border-emerald-400/40 bg-emerald-400/[0.07] hover:border-emerald-400/60"
          : "border-white/10 bg-white/[0.03] hover:border-[var(--accent)]/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-[11px] text-white/30">#{rank}</span>
        <span className="truncate text-sm font-medium capitalize text-white">{r.commodity}</span>
        {best && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-400/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
            {t("cargo.bestRoute")}
          </span>
        )}
        {fresh != null && (
          <span
            className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px]"
            style={fresh ? { color: "#34d399", background: "rgba(52,211,153,0.14)" } : { color: "#fbbf24", background: "rgba(251,191,36,0.14)" }}
          >
            {relativeAge(r.priceTimestamp, t)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[15px] font-medium text-emerald-400">
          +{fmt(r.profit)} <span className="text-[11px] font-normal text-white/40">aUEC</span>
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-white/70">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
        <span className="truncate capitalize">{from}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
        <span className="truncate capitalize">{to}</span>
        {r.profitPerMinute != null && (
          <span className="ml-auto shrink-0 text-[11px] text-[var(--accent)]">
            {fmt(r.profitPerMinute)} {t("cargo.unit.perMin")}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>{t("cargo.results.buy")} <span className="text-white/75">{fmt(r.buyPrice)}</span></span>
        <span>{t("cargo.results.sell")} <span className="text-white/75">{fmt(r.sellPrice)}</span></span>
        <span>{t("cargo.results.margin")} <span className="text-white/75">{fmt(r.marginUnit)}</span></span>
        <span>{t("cargo.results.qty")} <span className="text-white/75">{fmt(r.quantityScu)} SCU</span></span>
        <span>{t("cargo.results.distance")} <span className="text-white/75">{r.distanceGm != null ? `${r.distanceGm.toFixed(2)} Gm` : dash}</span></span>
        <span>{t("cargo.results.time")} <span className="text-white/75">{r.timeMinutes != null ? `${r.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}` : dash}</span></span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLoad();
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
        >
          <Truck className="h-3.5 w-3.5" />
          {t("cargo.loadToHold")}
        </button>
      </div>
    </div>
  );
}
