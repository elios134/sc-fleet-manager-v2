import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw } from "lucide-react";
import Dropdown, { type DropdownOption } from "../ui/Dropdown";
import ShipTopBanner from "./ShipTopBanner";
import {
  SALVAGE_SHIPS,
  combineSalvage,
  freshSalvage,
  type SalvageData,
  type SalvageHead,
  type SHMap,
} from "../../lib/salvageLoadout";

const NONE = "— Aucun —";

function fmtAUEC(n: number): string {
  const v = Math.round(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " M";
  if (v >= 1e4) return Math.round(v / 1e3) + " k";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " k";
  return "" + v;
}

export default function SalvagePlanner() {
  const { t } = useTranslation();
  const [heads, setHeads] = useState<SalvageHead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ship, setShip] = useState<string>("Vulture");
  const [picks, setPicks] = useState<string[]>(() => freshSalvage("Vulture"));

  useEffect(() => {
    let alive = true;
    invoke<SalvageData>("get_salvage_loadout")
      .then((d) => {
        if (!alive) return;
        setHeads(d.heads ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const H: SHMap = useMemo(() => {
    const m: SHMap = {};
    for (const h of heads) m[h.name] = h;
    return m;
  }, [heads]);

  const cfg = SALVAGE_SHIPS[ship];

  function pickShip(s: string) {
    setShip(s);
    setPicks(freshSalvage(s));
  }
  function setArm(i: number, name: string) {
    setPicks((prev) => prev.map((p, k) => (k === i ? name : p)));
  }

  function headOptions(): DropdownOption[] {
    const hs = heads.slice().sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: "", label: NONE }, ...hs.map((h) => ({ value: h.name, label: `${h.name}${h.price ? ` · ${fmtAUEC(h.price)}` : ""}` }))];
  }

  const stats = useMemo(() => combineSalvage(picks, H), [picks, H]);
  const equipped = useMemo(() => picks.map((p) => H[p]).filter(Boolean) as SalvageHead[], [picks, H]);
  const parts = useMemo(() => {
    const seen = new Set<string>();
    return equipped.filter((h) => (seen.has(h.name) ? false : (seen.add(h.name), true)));
  }, [equipped]);
  const anyHead = equipped.length > 0;

  if (loading)
    return (
      <div className="flex items-center gap-2 text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("miningLoadout.loading")}
      </div>
    );
  if (error)
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {t("miningLoadout.error")} {error}
      </div>
    );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">{t("miningLoadout.platform")}</span>
        <div className="min-w-[240px]">
          <Dropdown
            value={ship}
            onChange={pickShip}
            options={Object.keys(SALVAGE_SHIPS).map((s) => {
              const c = SALVAGE_SHIPS[s];
              return { value: s, label: `${s} · ${c.arms.length}× ${t("salvage.arm")}` };
            })}
            ariaLabel={t("miningLoadout.platform")}
          />
        </div>
        <button
          onClick={() => setPicks(freshSalvage(ship))}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("miningLoadout.reset")}
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <ShipTopBanner name={ship} />
          {cfg.arms.map((arm, i) => {
            const h = H[picks[i]];
            return (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold text-white">{arm}</span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent)]">S{cfg.size}</span>
                  <span className="ml-auto font-mono text-xs text-amber-300">{h?.extractionSpeed ? `${h.extractionSpeed} /s` : ""}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-20 shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/40">{t("salvage.scraper")}</label>
                  <div className="min-w-0 flex-1">
                    <Dropdown value={picks[i] ?? ""} onChange={(v) => setArm(i, v)} options={headOptions()} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="sticky top-4 rounded-2xl border border-white/10 bg-[#0a0a0f]/70 p-4 backdrop-blur">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">{t("salvage.speed")}</div>
          <div className="mt-1 font-mono text-3xl font-medium text-white">
            {anyHead ? stats.speed.toLocaleString("fr-FR") : "—"} <span className="text-sm text-white/40">/s</span>
          </div>

          <div className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">{t("miningLoadout.modifiers")}</div>
          <div className="flex items-center gap-2 border-b border-white/[0.06] py-1.5">
            <span className="flex-1 text-sm text-white/60">{t("salvage.radius")}</span>
            <span className="font-mono text-xs text-white">{stats.radius != null ? `${stats.radius} m` : "—"}</span>
          </div>
          <div className="flex items-center gap-2 border-b border-white/[0.06] py-1.5">
            <span className="flex-1 text-sm text-white/60">{t("salvage.efficiency")}</span>
            <span className="font-mono text-xs text-white">{stats.efficiency != null ? `${(stats.efficiency * 100).toFixed(0)} %` : "—"}</span>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-white/10 pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-white/50">{t("miningLoadout.totalPrice")}</span>
            <span className="font-mono text-lg text-amber-300">{fmtAUEC(stats.price)} aUEC</span>
          </div>

          {parts.length > 0 && (
            <>
              <div className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">{t("miningLoadout.whereToBuy")}</div>
              <div className="flex flex-col gap-1.5">
                {parts.map((p) => {
                  const b = p.buy?.[0];
                  return (
                    <div key={p.name} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
                      <span className="flex-1 truncate text-[12px] text-white/80">{p.name}</span>
                      {b ? (
                        <>
                          <span className="truncate font-mono text-[9px] text-white/40">{b.terminal}</span>
                          <span className="shrink-0 font-mono text-[11px] text-amber-300">{fmtAUEC(b.price)}</span>
                        </>
                      ) : (
                        <span className="font-mono text-[9px] text-white/30">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!anyHead && <p className="mt-3 text-[12px] leading-relaxed text-white/40">{t("salvage.pickScraper")}</p>}
        </aside>
      </div>
    </div>
  );
}
