import { MapPin } from "lucide-react";
import { type TFunction } from "i18next";
import { type PurchasePoint, fmt, locationStr } from "./shared";
import { FreshnessPill } from "./FreshnessPill";

// Carte d'un point de vente : magasin + lieu + fraîcheur du prix + prix. « best » = meilleur.
export function PriceCard({
  p,
  price,
  best,
  t,
}: {
  p: PurchasePoint;
  price: number | null | undefined;
  best?: boolean;
  t: TFunction;
}) {
  const shop = p.shopName || p.terminalName || "—";
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
        best ? "border-emerald-400/30 bg-emerald-400/10" : "border-white/10 bg-black/20"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${best ? "bg-emerald-400" : "bg-white/25"}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-white/90">{shop}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{locationStr(p)}</span>
          <FreshnessPill dateModified={p.dateModified} t={t} />
        </div>
      </div>
      {best && (
        <span className="shrink-0 rounded-full border border-emerald-400/40 px-1.5 py-px text-[9px] text-emerald-400">
          {t("catalogue.best")}
        </span>
      )}
      <span className={`shrink-0 text-sm font-semibold ${best ? "text-emerald-400" : "text-[var(--accent)]"}`}>
        {fmt(price)} <span className="text-[10px] text-white/50">{t("catalogue.aUEC")}</span>
      </span>
    </div>
  );
}
