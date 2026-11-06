import { useTranslation } from "react-i18next";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import { packInsuranceTone, type PackInsuranceTone } from "../lib/packView";
import type { PackShip } from "../types";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/60";
const TONE: Record<PackInsuranceTone, string> = {
  lti: "border-emerald-400/40 text-emerald-300",
  short: "border-[var(--amber)]/45 text-[var(--amber)]",
  unknown: "border-white/15 text-white/50",
  ok: "border-white/15 text-white/70",
};

/** Vaisseaux du pack : clic sur une ligne → fiche en fenêtre (si le vaisseau est identifié). */
export function PackShipsTable({ ships, onOpen }: { ships: PackShip[]; onOpen: (s: PackShip) => void }) {
  const { t } = useTranslation();
  const insurance = (s: PackShip) => {
    const tone = packInsuranceTone(s);
    if (tone === "lti") return "LTI";
    if (tone === "unknown") return t("shipCard.insuranceUnknown");
    return t("shipCard.insuranceMonths", { n: s.insuranceDuration });
  };
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("pack.colShip")}</th>
          <th className={th}>{t("pack.colRole")}</th>
          <th className={th}>{t("pack.colInsurance")}</th>
        </tr>
      </thead>
      <tbody>
        {ships.map((s, i) => {
          const img = resolveShipTopDownUrl(s.shipName) ?? s.imageUrl;
          const can = s.shipId != null;
          return (
            <tr
              key={s.shipId ?? `${s.shipName}-${i}`}
              onClick={can ? () => onOpen(s) : undefined}
              className={can ? "cursor-pointer transition-colors hover:bg-white/[0.03]" : ""}
            >
              <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                    {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-[9px] text-white/30">{t("common.noImage")}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">{s.shipName}</span>
                    <span className="block truncate text-[11px] text-white/45">{s.manufacturer}</span>
                  </span>
                </span>
              </td>
              <td className={td}>{s.role ?? "—"}</td>
              <td className={td}>
                <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] ${TONE[packInsuranceTone(s)]}`}>{insurance(s)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
