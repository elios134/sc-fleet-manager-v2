import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Hammer, Loader2, Package, ShoppingCart, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ComponentRow, type AcqDetailData } from "../types";

function AcquisitionDetailModal({
  comp,
  kind,
  onClose,
}: {
  comp: ComponentRow;
  kind: "buy" | "craft" | "stock";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<AcqDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<AcqDetailData>("get_acquisition_detail", { className: comp.className, name: comp.name })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [comp.className, comp.name]);

  const fmtT = (s: number | null) =>
    s == null ? null : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;

  const title =
    kind === "buy" ? t("loadout.acqBuy") : kind === "craft" ? t("loadout.acqCraft") : t("loadout.acqStock");
  const Icon = kind === "buy" ? ShoppingCart : kind === "craft" ? Hammer : Package;
  const color = kind === "buy" ? "#34d399" : kind === "craft" ? "#fbbf24" : "#93c5fd";

  // Craft → ouvre le blueprint. Achat/stock : les lieux/vaisseaux sont déjà listés
  // inline ci-dessus (le Catalogue est désormais organisé par lieu, pas par item).
  function goDetails() {
    if (kind === "craft" && data?.craft) {
      navigate("/crafting", { state: { blueprintId: data.craft.blueprintId } });
    }
  }
  const canGoDetails = kind === "craft" && !!data?.craft;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[70vh] w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ maxWidth: "460px", background: "rgba(13,17,23,0.98)", borderColor: "rgba(255,255,255,0.12)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3.5">
          <Icon className="h-4 w-4 shrink-0" style={{ color }} />
          <span className="text-sm font-semibold" style={{ color }}>
            {title}
          </span>
          <span className="truncate text-xs text-white/50">· {comp.name}</span>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loadout.loadingShort")}
            </div>
          ) : kind === "buy" ? (
            (data?.buy.length ?? 0) === 0 ? (
              <p className="text-white/40">{t("loadout.acqNotBuy")}</p>
            ) : (
              <ul className="space-y-1.5">
                {data!.buy.map((b, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate text-white/70">{b.terminal ?? "—"}</span>
                    <span className="shrink-0 font-mono text-white/90">
                      {b.price != null ? `${b.price.toLocaleString("fr-FR")} aUEC` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : kind === "craft" ? (
            !data?.craft ? (
              <p className="text-white/40">{t("loadout.acqNotCraft")}</p>
            ) : (
              <div className="space-y-3">
                {fmtT(data.craft.timeSeconds) && (
                  <div className="text-white/70">
                    {t("loadout.acqCraftTime")} <span className="text-white/90">{fmtT(data.craft.timeSeconds)}</span>
                  </div>
                )}
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    {data.craft.ingredients.length} {t("loadout.acqCraftIngr")}
                  </div>
                  <ul className="space-y-1.5">
                    {data.craft.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span className="truncate text-white/70">{ing.name ?? "—"}</span>
                        {ing.qty != null && <span className="shrink-0 font-mono text-white/90">×{ing.qty}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          ) : (data?.ships.length ?? 0) === 0 ? (
            <p className="text-white/40">{t("loadout.acqNotStock")}</p>
          ) : (
            <ul className="space-y-1.5">
              {data!.ships.filter(Boolean).map((s, i) => (
                <li key={i} className="text-white/70">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canGoDetails && (
          <div className="flex justify-end border-t border-white/10 px-5 py-3">
            <button
              onClick={goDetails}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              {t("loadout.acqShowDetails")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { AcquisitionDetailModal };
