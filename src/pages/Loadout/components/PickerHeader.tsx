import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** En-tête du sélecteur : emplacement, taille, nombre de composants, regroupement, fermeture. */
export function PickerHeader({
  portLabel,
  slotSize,
  count,
  sorted,
  onRegroup,
  isMount,
  missile,
  onClear,
  onClose,
}: {
  portLabel: string;
  slotSize: number;
  count: number;
  sorted: boolean;
  onRegroup: () => void;
  isMount: boolean;
  missile: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-white/10 px-6 py-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {t("loadout.pickerConfigTitle")}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-base uppercase tracking-wide" style={{ color: "#60a5fa" }}>
          {portLabel}
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            background: "rgba(96,165,250,0.12)",
            border: "1px solid rgba(96,165,250,0.25)",
            color: "#60a5fa",
          }}
        >
          S{slotSize}
        </span>
        <span className="text-[10px] font-semibold uppercase text-white/40">
          {t("loadout.pickerComponentCount", { count })}
        </span>
        {sorted && (
          <button
            onClick={onRegroup}
            className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/60 transition-colors hover:bg-white/10"
            title={t("loadout.pickerRegroupTitle")}
          >
            {t("loadout.pickerRegroup")}
          </button>
        )}
        {isMount && (
          <button
            onClick={onClear}
            className="ml-auto rounded-full border px-3 py-1 text-[10px] font-semibold uppercase transition-opacity hover:opacity-90"
            style={{
              color: "rgba(255,170,80,0.95)",
              border: "1px solid rgba(255,136,0,0.3)",
              background: "rgba(255,136,0,0.08)",
            }}
          >
            {t("loadout.pickerLeaveEmpty")}
          </button>
        )}
        <button
          onClick={onClose}
          aria-label={t("loadout.pickerClose")}
          className={`${isMount ? "" : "ml-auto"} rounded-lg p-1 text-white/50 hover:bg-white/10`}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {isMount && (
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,136,0,0.75)" }}>
          {t("loadout.pickerMountHint", { mount: missile ? t("loadout.pickerMissileRack") : t("loadout.pickerCarrier") })}
        </div>
      )}
    </div>
  );
}
