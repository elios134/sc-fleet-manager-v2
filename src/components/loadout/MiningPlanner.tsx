import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw } from "lucide-react";
import Dropdown, { type DropdownOption } from "../ui/Dropdown";
import ShipTopBanner from "./ShipTopBanner";
import {
  SHIPS,
  GOOD,
  STAT_LABELS,
  calc,
  totalPrice,
  turretPower,
  freshLoadout,
  indexByName,
  type MiningData,
  type Turret,
  type Laser,
  type MiningModule,
  type Gadget,
} from "../../lib/miningLoadout";

const NONE = "— Aucun —";

function fmtAUEC(n: number): string {
  const v = Math.round(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " M";
  if (v >= 1e4) return Math.round(v / 1e3) + " k";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " k";
  return "" + v;
}
function fmtPow(n: number): string {
  return Math.round(n || 0).toLocaleString("fr-FR");
}

export default function MiningPlanner() {
  const { t } = useTranslation();
  const [data, setData] = useState<MiningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ship, setShip] = useState<string>("Prospector");
  const [loadout, setLoadout] = useState<Turret[]>(() => freshLoadout("Prospector").loadout);
  const [gadget, setGadget] = useState<string>("");

  useEffect(() => {
    let alive = true;
    invoke<MiningData>("get_mining_loadout")
      .then((d) => {
        if (!alive) return;
        setData({ lasers: d.lasers ?? [], modules: d.modules ?? [], gadgets: d.gadgets ?? [], generatedUnix: d.generatedUnix });
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

  const L = useMemo(() => indexByName<Laser>(data?.lasers ?? []), [data]);
  const M = useMemo(() => indexByName<MiningModule>(data?.modules ?? []), [data]);
  const G = useMemo(() => indexByName<Gadget>(data?.gadgets ?? []), [data]);

  const cfg = SHIPS[ship];

  function pickShip(s: string) {
    setShip(s);
    const fl = freshLoadout(s);
    setLoadout(fl.loadout);
    setGadget(fl.gadget);
  }
  function reset() {
    const fl = freshLoadout(ship);
    setLoadout(fl.loadout);
    setGadget(fl.gadget);
  }
  function setLaser(ti: number, name: string) {
    setLoadout((prev) => {
      const next = prev.map((tu) => ({ laser: tu.laser, modules: [...tu.modules] }));
      next[ti].laser = name;
      const l = L[name];
      const slots = l ? l.moduleSlots : cfg.slots;
      next[ti].modules = Array(slots)
        .fill("")
        .map((_, i) => next[ti].modules[i] ?? "");
      return next;
    });
  }
  function setModule(ti: number, si: number, name: string) {
    setLoadout((prev) => {
      const next = prev.map((tu) => ({ laser: tu.laser, modules: [...tu.modules] }));
      next[ti].modules[si] = name;
      return next;
    });
  }

  function laserOptions(size: number): DropdownOption[] {
    const ls = (data?.lasers ?? []).filter((l) => l.size === size).sort((a, b) => (b.maxPower ?? 0) - (a.maxPower ?? 0));
    return [{ value: "", label: NONE }, ...ls.map((l) => ({ value: l.name, label: `${l.name}${l.price ? ` · ${fmtAUEC(l.price)}` : ""}` }))];
  }
  function moduleOptions(): DropdownOption[] {
    const ms = (data?.modules ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: "", label: NONE }, ...ms.map((m) => ({ value: m.name, label: `${m.name} · ${m.type === "Active" ? "actif" : "passif"}` }))];
  }
  function gadgetOptions(): DropdownOption[] {
    const gs = (data?.gadgets ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: "", label: NONE }, ...gs.map((g) => ({ value: g.name, label: g.name }))];
  }

  const stats = useMemo(() => calc(loadout, gadget, L, M, G), [loadout, gadget, L, M, G]);
  const price = useMemo(() => totalPrice(loadout, gadget, cfg.stock, L, M, G), [loadout, gadget, cfg, L, M, G]);
  const anyLaser = loadout.some((tu) => L[tu.laser]);

  const parts = useMemo(() => {
    const arr: Array<Laser | MiningModule | Gadget> = [];
    for (const tu of loadout) {
      if (L[tu.laser]) arr.push(L[tu.laser]);
      for (const mn of tu.modules) if (M[mn]) arr.push(M[mn]);
    }
    if (G[gadget]) arr.push(G[gadget]);
    const seen = new Set<string>();
    return arr.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
  }, [loadout, gadget, L, M, G]);

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
            options={Object.keys(SHIPS).map((s) => {
              const c = SHIPS[s];
              const meta = c.na ? c.na : c.fixed ? t("miningLoadout.fixedLaser") : `${c.turrets.length}× S${c.size}`;
              return { value: s, label: `${s} · ${meta}` };
            })}
            ariaLabel={t("miningLoadout.platform")}
          />
        </div>
        <button
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("miningLoadout.reset")}
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[65fr_35fr]">
        <div className="flex flex-col gap-4">
          <ShipTopBanner name={ship} />
          {cfg.fixed ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-semibold text-white">{cfg.turrets[0]}</span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent)]">
                  S{cfg.size} · {t("miningLoadout.fixed")}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-white/60">{cfg.info}</p>
            </div>
          ) : (
            <>
              {cfg.turrets.map((tn, ti) => {
                const turret = loadout[ti] ?? { laser: "", modules: [] };
                const laser = L[turret.laser];
                const slots = laser ? laser.moduleSlots : cfg.slots;
                const pw = laser ? turretPower(turret, L, M) : 0;
                return (
                  <div key={ti} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="font-semibold text-white">{tn}</span>
                      <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent)]">S{cfg.size}</span>
                      <span className="ml-auto font-mono text-xs text-amber-300">{pw ? `${fmtPow(pw)} /s` : ""}</span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-3">
                        <label className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/40">{t("miningLoadout.laserHead")}</label>
                        <div className="min-w-0 flex-1">
                          <Dropdown value={turret.laser} onChange={(v) => setLaser(ti, v)} options={laserOptions(cfg.size)} />
                        </div>
                      </div>
                      {Array.from({ length: slots }).map((_, si) => (
                        <div key={si} className="flex items-center gap-3">
                          <label className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/40">
                            {t("miningLoadout.module")} {si + 1}
                          </label>
                          <div className="min-w-0 flex-1">
                            <Dropdown value={turret.modules[si] ?? ""} onChange={(v) => setModule(ti, si, v)} options={moduleOptions()} disabled={!laser} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold text-white">{t("miningLoadout.gadget")}</span>
                  <span className="ml-auto font-mono text-xs text-amber-300">{G[gadget]?.price ? fmtAUEC(G[gadget].price) : ""}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/40">{t("miningLoadout.gadget")}</label>
                  <div className="min-w-0 flex-1">
                    <Dropdown value={gadget} onChange={setGadget} options={gadgetOptions()} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="sticky top-4 rounded-2xl border border-white/10 bg-[#0a0a0f]/70 p-4 backdrop-blur">
          {cfg.fixed ? (
            <p className="text-sm leading-relaxed text-white/60">
              {cfg.info}
              {cfg.src ? ` · ${t("miningLoadout.source")} ${cfg.src}` : ""}
            </p>
          ) : (
            <>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">{t("miningLoadout.power")}</div>
              <div className="mt-1 font-mono text-3xl font-medium text-white">
                {anyLaser ? `${fmtPow(stats.minP)}–${fmtPow(stats.maxP)}` : "—"} <span className="text-sm text-white/40">/s</span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-white/40">
                {stats.extP ? `${t("miningLoadout.extraction")} ${fmtPow(stats.extP)} · ` : ""}
                {stats.optRange ? `${t("miningLoadout.optRange")} ${Math.round(stats.optRange)} m` : ""}
              </div>

              <div className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">{t("miningLoadout.modifiers")}</div>
              {STAT_LABELS.map(([k, lab]) => {
                const v = (stats as unknown as Record<string, number>)[k] || 0;
                const dir = GOOD[k] || 1;
                const neutral = Math.abs(v) < 0.05;
                const good = v * dir > 0;
                const w = Math.min(50, Math.abs(v) / 2);
                return (
                  <div key={k} className="flex items-center gap-2 border-b border-white/[0.06] py-1.5">
                    <span className="flex-1 text-sm text-white/60">{lab}</span>
                    <span className="relative h-1 w-16 overflow-hidden rounded bg-black/40">
                      <i
                        className="absolute top-0 bottom-0"
                        style={{ width: `${w}%`, left: v >= 0 ? "50%" : `${50 - w}%`, background: neutral ? "var(--accent)" : good ? "#46e6a0" : "#ff6b6b", opacity: neutral ? 0.3 : 1 }}
                      />
                    </span>
                    <span className={["w-12 text-right font-mono text-xs", neutral ? "text-white/40" : good ? "text-emerald-400" : "text-red-400"].join(" ")}>
                      {neutral ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                    </span>
                  </div>
                );
              })}

              <div className="mt-4 flex items-baseline justify-between border-t border-white/10 pt-3">
                <span className="text-xs font-medium uppercase tracking-wide text-white/50">{t("miningLoadout.totalPrice")}</span>
                <span className="font-mono text-lg text-amber-300">{fmtAUEC(price)} aUEC</span>
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

              {!anyLaser && <p className="mt-3 text-[12px] leading-relaxed text-white/40">{t("miningLoadout.pickLaser")}</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
