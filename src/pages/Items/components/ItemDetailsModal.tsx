import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HangarItem } from "../types";
import { KIND_META, kindLabel, normalizeRsiImageUrl } from "../helpers";
import ItemGlyph from "./ItemGlyph";

/* Modale détail d'un objet (visuel + type + pledge source). */
export default function ItemDetailsModal({
  item,
  pledgeName,
  onClose,
}: {
  item: HangarItem;
  pledgeName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const meta = item.kind ? KIND_META[item.kind] : undefined;
  const label = kindLabel(item.kind, t);
  const img = normalizeRsiImageUrl(item.imageUrl);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10"
          aria-label={t("action.close")}
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex h-[26rem] w-full items-center justify-center bg-white/5 p-4">
          {img ? (
            <img src={img} alt={item.title} className="h-full w-full object-contain" />
          ) : (
            <span className="text-white/30">
              <ItemGlyph size={80} color={meta?.color} />
            </span>
          )}
        </div>
        <div className="p-5">
          {label && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={
                meta
                  ? { background: `${meta.color}26`, color: meta.color, border: `1px solid ${meta.color}55` }
                  : { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)" }
              }
            >
              {meta && <meta.Icon className="h-3 w-3" />}
              {label}
            </span>
          )}
          <h2 className="mt-2 text-lg font-bold text-white">{item.title}</h2>
          {item.manufacturer && <p className="text-sm text-white/50">{item.manufacturer}</p>}
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="text-xs uppercase tracking-wider text-white/40">{t("items.sourcePledge2")}</p>
            <p className="text-sm text-white/70">{pledgeName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
