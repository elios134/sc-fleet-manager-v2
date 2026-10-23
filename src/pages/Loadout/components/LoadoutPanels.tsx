import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { loadoutCost, powerPips, type Provenance, fmtMinutes, routeKey } from "../cost";
import type { SlotEdit } from "../types";
import { aggregateLoadoutStats } from "../../../lib/loadoutStats";
import { appLocale } from "../../../lib/format";

const fmt = (n: number) => Math.round(n).toLocaleString(appLocale());

/* Barre de stats collante (valeurs déjà calculées par aggregateLoadoutStats). */
export function StatBar({ slots }: { slots: SlotEdit[] }) {
  const { t } = useTranslation();
  const s = aggregateLoadoutStats(slots);
  const cells: { k: string; v: string; u?: string; acc?: boolean }[] = [
    { k: t("loadout.statAlpha"), v: s.totalAlphaDamage > 0 ? fmt(s.totalAlphaDamage) : "—" },
    { k: t("loadout.statDps"), v: s.totalDps > 0 ? fmt(s.totalDps) : "—", acc: true },
    { k: t("loadout.statShield"), v: s.totalShieldHp > 0 ? fmt(s.totalShieldHp) : "—", u: "HP" },
    { k: t("loadout.statRegen"), v: s.shieldRegenRate != null && s.shieldRegenRate > 0 ? fmt(s.shieldRegenRate) : "—", u: "HP/s" },
    { k: t("loadout.statPower"), v: s.totalPowerOutput > 0 ? `${fmt(s.totalPowerDraw)} / ${fmt(s.totalPowerOutput)}` : "—" },
  ];
  return (
    <div className="glass sticky top-0 z-10 mb-4 grid grid-cols-2 overflow-hidden rounded-2xl sm:grid-cols-5">
      {cells.map((c) => (
        <div key={c.k} className="border-b border-r border-white/10 px-3.5 py-2.5 last:border-r-0 sm:border-b-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/40">{c.k}</p>
          <p className={`text-xl font-extrabold tabular-nums ${c.acc ? "text-indigo-200" : "text-white"}`}>
            {c.v}{c.u && c.v !== "—" && <span className="ml-0.5 text-[11px] font-medium text-white/40">{c.u}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

/* Énergie en pips : part de la production consommée. */
export function EnergyPips({ slots }: { slots: SlotEdit[] }) {
  const { t } = useTranslation();
  const s = aggregateLoadoutStats(slots);
  if (s.totalPowerOutput <= 0) return null;
  const { on, over } = powerPips(s.totalPowerDraw, s.totalPowerOutput, 10);
  return (
    <section className="glass mb-4 rounded-2xl px-4 py-3">
      <header className="mb-2 flex items-center text-xs font-bold uppercase tracking-[0.08em] text-white/60">
        {t("loadout.energy")}
        <span className={`ml-auto tabular-nums ${over ? "text-red-300" : "text-indigo-200"}`}>{fmt(s.totalPowerDraw)} / {fmt(s.totalPowerOutput)}</span>
      </header>
      <div className="flex gap-1" aria-label={t("loadout.energy")}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`h-3.5 flex-1 rounded ${i < on ? (over ? "bg-red-400" : "bg-[var(--accent)] shadow-[0_0_10px_rgba(99,102,241,0.6)]") : "bg-white/10"}`} />
        ))}
      </div>
    </section>
  );
}

type RouteResult = { found: boolean; totalAuec: number; totalMinutes: number | null; stops: { terminalName: string }[]; unresolvedItems: string[] };

/* Coût du loadout + tournée d'achat (plan_shopping_route, comme le panier du catalogue). */
export function LoadoutCost({ items }: { items: { name: string; prov: Provenance }[] }) {
  const { t } = useTranslation();
  const [planned, setPlanned] = useState<{ key: string; result: RouteResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = loadoutCost(items.map((x) => x.prov));
  if (items.length === 0) return null;
  const toBuy = items.filter((x) => x.prov.kind === "buy");
  const key = routeKey(toBuy.map((x) => x.name));
  // Loadout modifié depuis le calcul → ancien résultat masqué (à relancer).
  const route = planned?.key === key ? planned.result : null;

  const plan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const result = await invoke<RouteResult>("plan_shopping_route", { items: toBuy.map((x) => ({ idItem: null, uuid: null, name: x.name })), startUuid: null });
      setPlanned({ key, result });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass mb-4 flex flex-col gap-2 rounded-2xl border-[var(--accent)]/40 px-4 py-3.5">
      <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-white/60">{t("loadout.cost")}</h3>
      <Row label={t("loadout.costOwned")} value={t("loadout.pieces", { n: c.owned })} />
      {c.byTerminal.map((x) => <Row key={x.terminal} label={t("loadout.costBuyAt", { where: x.terminal })} value={`${fmt(x.total)} aUEC`} />)}
      {c.craft > 0 && <Row label={t("loadout.costCraft")} value={t("loadout.pieces", { n: c.craft })} />}
      {c.unknown > 0 && <Row label={t("loadout.costUnknown")} value={t("loadout.pieces", { n: c.unknown })} />}
      <div className="flex items-baseline justify-between border-t border-white/10 pt-2.5 text-xs font-bold uppercase tracking-[0.08em] text-white/60">
        {t("loadout.costTotal")}
        <span className="text-[22px] normal-case tracking-normal text-indigo-200 tabular-nums">{fmt(c.total)}<span className="ml-1 text-[11px] text-white/40">aUEC</span></span>
      </div>
      {toBuy.length > 0 && (
        <button type="button" onClick={() => void plan()} disabled={busy} className="flex items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t("loadout.planRoute")}
        </button>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      {route && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/65">
          {route.found
            ? t("loadout.routeSummary", { stops: route.stops.length, min: fmtMinutes(route.totalMinutes), total: fmt(route.totalAuec) })
            : t("loadout.routeNone")}
          {route.unresolvedItems.length > 0 && <p className="mt-1 text-white/45">{t("loadout.routeUnresolved", { items: route.unresolvedItems.join(", ") })}</p>}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2.5 text-[12.5px] text-white/60">
      <span className="min-w-0 truncate">{label}</span>
      <b className="whitespace-nowrap font-semibold tabular-nums text-white">{value}</b>
    </div>
  );
}
