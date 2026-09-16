import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HangarItem, PledgeGroup } from "../types";
import { KIND_META, kindLabel, normalizeRsiImageUrl } from "../helpers";
import ItemGlyph from "./ItemGlyph";
import ItemDetailsModal from "./ItemDetailsModal";

/* Modale pack : liste des objets du pledge, chacun ouvrant sa fiche détaillée. */
export default function ItemPackageModal({
  pledge,
  onClose,
}: {
  pledge: PledgeGroup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<HangarItem | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
          style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{pledge.name}</h2>
              <p className="text-sm text-white/40">{t("items.itemsCount", { n: pledge.items.length })}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-white/60 hover:bg-white/10"
              aria-label={t("action.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {pledge.items.map((it) => {
              const meta = it.kind ? KIND_META[it.kind] : undefined;
              const label = kindLabel(it.kind, t);
              const img = normalizeRsiImageUrl(it.imageUrl);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelected(it)}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-2 text-left transition-colors hover:bg-white/10"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10 text-white/30">
                    {img ? (
                      <img src={img} alt={it.title} className="h-full w-full object-cover" />
                    ) : (
                      <ItemGlyph size={20} color={meta?.color} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{it.title}</span>
                    {it.manufacturer && (
                      <span className="block truncate text-xs text-white/40">{it.manufacturer}</span>
                    )}
                  </span>
                  {label && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={
                        meta
                          ? { background: `${meta.color}26`, color: meta.color }
                          : { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.60)" }
                      }
                    >
                      {label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <ItemDetailsModal item={selected} pledgeName={pledge.name} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
