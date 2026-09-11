import { Rocket, Coins, Navigation } from "lucide-react";
import Dropdown from "../../../components/ui/Dropdown";
import { type CargoCtx } from "../types";
import { SYSTEMS, relativeAge, priceFresh } from "../helpers";

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

export { ContextBar };
