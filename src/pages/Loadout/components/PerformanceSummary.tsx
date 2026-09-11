import { Radar, ShieldHalf, Swords, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type SlotEdit, type ShipMeta } from "../types";
import { aggregateLoadoutStats, getSignatureLevel, fmtStat } from "../helpers";

function StatSection({
  label,
  icon: Icon,
  mainValue,
  mainColor,
  rows,
  progressPercent,
}: {
  label: string;
  icon?: LucideIcon;
  mainValue: string;
  mainColor: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  progressPercent?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          {Icon && <Icon className="h-3.5 w-3.5" style={{ color: mainColor }} />}
          {label}
        </span>
        <span className="font-mono text-sm font-bold" style={{ color: mainColor }}>
          {mainValue}
        </span>
      </div>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-[11px]">
            <span className="text-white/70">{row.label}</span>
            <span className="font-mono" style={{ color: row.color ?? mainColor }}>
              {row.value}
            </span>
          </div>
        ))}
        {progressPercent !== undefined && (
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                background: mainColor,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceSummary({ slots, ship }: { slots: SlotEdit[]; ship: ShipMeta | null }) {
  const { t } = useTranslation();
  const stats = aggregateLoadoutStats(slots);

  const dpsDisplay = stats.totalDps > 0 ? `${Math.round(stats.totalDps)} DPS` : "— DPS";
  const shieldDisplay = stats.totalShieldHp > 0 ? `${Math.round(stats.totalShieldHp)} HP` : "— HP";
  const powerDisplay = stats.totalPowerDraw > 0 ? `${Math.round(stats.totalPowerDraw)} kW/s` : "— kW/s";

  const dpsProgress = Math.min(100, (stats.totalDps / 2000) * 100);
  const shieldProgress = Math.min(100, (stats.totalShieldHp / 6000) * 100);
  const powerProgress =
    stats.totalPowerOutput > 0
      ? Math.min(100, (stats.totalPowerDraw / stats.totalPowerOutput) * 100)
      : stats.totalPowerDraw > 0
        ? Math.min(100, (stats.totalPowerDraw / 500) * 100)
        : 0;

  const sigLevel = getSignatureLevel(ship?.crossSection ?? null, t);

  const powerMarginStr =
    stats.powerMargin != null
      ? `${stats.powerMargin > 0 ? "+" : ""}${stats.powerMargin.toFixed(1)}%`
      : "—";
  const inDeficit = stats.powerMargin != null && stats.powerMargin < 0;
  const powerMarginColor =
    stats.powerMargin == null ? undefined : stats.powerMargin >= 0 ? "#34d399" : "#f87171";
  // En déficit, toute la section ÉNERGIE (valeur principale + barre) passe en rouge.
  const powerSectionColor = inDeficit ? "#f87171" : "#60a5fa";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/70">
        {t("loadout.performance")}
      </h2>
      <div className="space-y-5">
        <StatSection
          label={t("loadout.statOffensive")}
          icon={Swords}
          mainValue={dpsDisplay}
          mainColor="#60a5fa"
          rows={[
            {
              label: t("loadout.rowAlphaDamage"),
              value: stats.totalAlphaDamage > 0 ? fmtStat(stats.totalAlphaDamage) : "—",
            },
            { label: t("loadout.rowBurstDps"), value: "—" },
          ]}
          progressPercent={dpsProgress}
        />

        <StatSection
          label={t("loadout.statDefensive")}
          icon={ShieldHalf}
          mainValue={shieldDisplay}
          mainColor="#fbbf24"
          rows={[
            {
              label: t("loadout.rowShieldRegen"),
              value: stats.shieldRegenRate > 0 ? `${fmtStat(stats.shieldRegenRate)} HP/s` : "—",
              color: "#fbbf24",
            },
            {
              label: t("loadout.rowShieldDelay"),
              value: stats.shieldDelayDmg != null ? `${stats.shieldDelayDmg.toFixed(1)} s` : "—",
              color: "#fbbf24",
            },
          ]}
          progressPercent={shieldProgress}
        />

        <StatSection
          label={t("loadout.statRadarSig")}
          icon={Radar}
          mainValue={sigLevel}
          mainColor="rgba(255,255,255,0.8)"
          rows={[
            {
              label: t("loadout.rowEmSignature"),
              value: ship?.emSignature != null ? fmtStat(ship.emSignature) : "—",
              color: "#93ccff",
            },
            {
              label: t("loadout.rowIrSignature"),
              value: ship?.irSignature != null ? fmtStat(ship.irSignature) : "—",
              color: "#f87171",
            },
            {
              label: t("loadout.rowCrossSection"),
              value: ship?.crossSection != null ? fmtStat(ship.crossSection) : "—",
            },
          ]}
        />

        <StatSection
          label={t("loadout.statEnergy")}
          icon={Zap}
          mainValue={powerDisplay}
          mainColor={powerSectionColor}
          rows={[
            {
              label: t("loadout.rowOutput"),
              value: stats.totalPowerOutput > 0 ? `${fmtStat(stats.totalPowerOutput)} kW` : "—",
            },
            { label: t("loadout.rowMargin"), value: powerMarginStr, color: powerMarginColor },
          ]}
          progressPercent={powerProgress}
        />
      </div>
    </div>
  );
}

// Mini-modale de détail d'acquisition (clic sur 🛒/🔧/📦) : lieux d'achat, recette/ingrédients,
// ou vaisseaux. Bouton « Afficher en détails » → onglet associé (craft / catalogue) ciblé.

export { StatSection, PerformanceSummary };
