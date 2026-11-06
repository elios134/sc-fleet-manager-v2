import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { insuranceTone, type FleetRow, type InsuranceTone } from "../lib/fleetView";
import { formatPriceUsd, rentalDaysLeft } from "../helpers";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import type { ShipRow } from "../types";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/60";
const TONE: Record<InsuranceTone, string> = {
  lti: "border-emerald-400/40 text-emerald-300",
  short: "border-[var(--amber)]/45 text-[var(--amber)]",
  rental: "border-[var(--accent)]/50 text-white",
  unknown: "border-white/15 text-white/50",
  ok: "border-white/15 text-white/70",
};

/** Libellé de la pastille d'assurance (LTI, N mois, location : jours restants). */
function insuranceLabel(s: ShipRow, t: (k: string, o?: Record<string, unknown>) => string): string {
  const tone = insuranceTone(s);
  if (tone === "lti") return "LTI";
  if (tone === "rental") {
    const d = rentalDaysLeft(s.rentalExpiresAt);
    return d != null && d <= 0 ? t("shipCard.acqRentedExpired") : t("shipCard.acqRentedExpiresIn", { days: d ?? 0 });
  }
  if (tone === "unknown") return t("shipCard.insuranceUnknown");
  return t("shipCard.insuranceMonths", { n: s.insuranceDuration });
}

/** Ligne d'un pack : son résumé et le bouton qui ouvre la page du pack, avec tous ses vaisseaux. */
function PackLine({ row, onOpen, t }: { row: Extract<FleetRow, { kind: "pack" }>; onOpen: (packId: number) => void; t: (k: string, o?: Record<string, unknown>) => string }) {
  const img = resolveShipTopDownUrl(row.firstShip.name) ?? row.firstShip.imageUrl;
  return (
    <tr onClick={() => onOpen(row.packId)} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
      <td className="border-b border-white/[0.06] px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-muted)]">
            {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" /> : <Package className="h-5 w-5 text-white/50" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{row.name}</span>
            <span className="block truncate text-[11px] text-white/45">{t("fleet.packShips", { count: row.shipCount })}</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row.packId);
            }}
            className="shrink-0 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-125"
          >
            {t("fleet.viewWholePack")}
          </button>
        </span>
      </td>
      <td className={td}>{t("fleet.packClass")}</td>
      <td className={`${td} text-right tabular-nums`}>—</td>
      <td className={`${td} text-right tabular-nums`}>{row.cargo > 0 ? `${row.cargo} SCU` : "—"}</td>
      <td className={td}>
        {row.ltiCount > 0 && (
          <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] ${TONE.lti}`}>
            {row.ltiCount === row.shipCount ? "LTI" : t("fleet.packLti", { n: row.ltiCount, total: row.shipCount })}
          </span>
        )}
      </td>
      <td className={`${td} text-right tabular-nums text-white/80`}>{formatPriceUsd(row.valueUsd)}</td>
    </tr>
  );
}

/** Tableau de la flotte : clic sur un vaisseau → fiche en fenêtre ; clic sur un pack → page du pack. */
export function FleetTable({ rows, selectedId, onSelect, onOpenPack }: { rows: FleetRow[]; selectedId: number | null; onSelect: (s: ShipRow) => void; onOpenPack: (packId: number) => void }) {
  const { t } = useTranslation();
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("fleet.colShip")}</th>
          <th className={th}>{t("fleet.colClass")}</th>
          <th className={`${th} text-right`}>{t("fleet.colCrew")}</th>
          <th className={`${th} text-right`}>{t("fleet.colCargo")}</th>
          <th className={th}>{t("fleet.colInsurance")}</th>
          <th className={`${th} text-right`}>{t("fleet.colValue")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          if (row.kind === "pack") return <PackLine key={`pack-${row.packId}`} row={row} onOpen={onOpenPack} t={t} />;
          const s = row.ship;
          const sel = s.id === selectedId;
          const img = resolveShipTopDownUrl(s.name) ?? s.imageUrl;
          return (
            <tr
              key={s.id}
              onClick={() => onSelect(s)}
              aria-selected={sel}
              className={`cursor-pointer transition-colors ${sel ? "bg-[var(--accent-muted)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.03]"}`}
            >
              <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                    {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">{s.name}</span>
                    <span className="block truncate text-[11px] text-white/45">{s.shipDataManufacturer ?? s.manufacturer}</span>
                  </span>
                </span>
              </td>
              <td className={td}>{s.shipDataClassification ?? "—"}</td>
              <td className={`${td} text-right tabular-nums`}>{s.crewMax ?? "—"}</td>
              <td className={`${td} text-right tabular-nums`}>{s.cargoScu != null ? `${s.cargoScu} SCU` : "—"}</td>
              <td className={td}>
                <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] ${TONE[insuranceTone(s)]}`}>{insuranceLabel(s, t)}</span>
              </td>
              <td className={`${td} text-right tabular-nums text-white/80`}>{formatPriceUsd(s.currentValueUsd)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
