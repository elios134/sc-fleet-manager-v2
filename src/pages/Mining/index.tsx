// Companion minier — work order de bout en bout : brut saisi → valeur au scan →
// meilleure méthode de raffinage (profit vs temps) → où vendre le raffiné + profit net.
// Formule = registre statique (miningRegistry) ; prix = UEX live (get_refinery_sell_prices).
// DA SC Fleet (tokens theme.css, lucide, i18n). Build lasers/gadgets = MiningPlanner (Loadout).

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Pickaxe, Wrench } from "lucide-react";
import type { OreLine, SellPoint, RefinerySellRow } from "./types";
import { toSellPoints, rankMethods, totalScu } from "./helpers";
import { OreInput } from "./components/OreInput";
import { ScanValue } from "./components/ScanValue";
import { RefineOptimizer } from "./components/RefineOptimizer";
import { SellRecommendation } from "./components/SellRecommendation";
import { RefineryLocations } from "./components/RefineryLocations";
import { WorkOrderSummary } from "./components/WorkOrderSummary";

function Card({ title, children, className = "", extra }: { title?: string; children: React.ReactNode; className?: string; extra?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/50">{title}</span>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

export default function MiningPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ore, setOre] = useState<OreLine[]>([{ key: "quantanium", scu: 32 }]);
  const [sells, setSells] = useState<Record<string, SellPoint>>({});
  const [by, setBy] = useState<"net" | "netPerHour">("net");
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await invoke<RefinerySellRow[]>("get_refinery_sell_prices");
      setSells(toSellPoints(rows ?? []));
    } catch {
      setSells({}); // repli hors-ligne (FALLBACK_SELL)
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const results = useMemo(() => rankMethods(ore, sells, by), [ore, sells, by]);
  const activeKey = chosenKey ?? results[0]?.key ?? null;
  const chosen = results.find((r) => r.key === activeKey) ?? results[0] ?? null;
  const rawScu = totalScu(ore);
  const anyLive = Object.keys(sells).length > 0;

  return (
    <div className="p-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("mining.eyebrow")}</p>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Pickaxe className="h-6 w-6 text-[var(--accent)]" /> {t("mining.title")}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-white/45">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: anyLive ? "#2ee9a5" : "var(--amber)", boxShadow: anyLive ? "0 0 8px #2ee9a5" : "none" }}
            />
            {anyLive ? t("mining.pricesLive") : t("mining.pricesOffline")}
          </p>
        </div>
        <button
          onClick={() => navigate("/loadout")}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-[12.5px] font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          <Wrench className="h-4 w-4" /> {t("mining.toBuild")}
        </button>
      </header>

      <div className="mb-4">
        <WorkOrderSummary chosen={chosen} rawScu={rawScu} t={t} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4">
          <Card title={t("mining.oreTitle")}>
            <OreInput ore={ore} onChange={setOre} t={t} />
          </Card>
          <Card title={t("mining.scanTitle")}>
            <ScanValue ore={ore} sells={sells} t={t} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <RefineOptimizer results={results} chosenKey={activeKey} onPick={setChosenKey} by={by} onBy={setBy} t={t} />
          </Card>
          <Card title={t("mining.refineWhereTitle")} extra={<span className="text-[11px] font-normal normal-case tracking-normal text-white/35">{t("mining.refineWhereHint")}</span>}>
            <RefineryLocations t={t} />
          </Card>
          <Card title={t("mining.sellTitle")}>
            <SellRecommendation ore={ore} sells={sells} methodKey={activeKey} t={t} />
          </Card>
        </div>
      </div>
    </div>
  );
}
