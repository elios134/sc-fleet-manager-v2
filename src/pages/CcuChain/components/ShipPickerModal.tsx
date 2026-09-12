import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Dropdown from "../../../components/ui/Dropdown";
import { type CcuShip } from "../types";
import { fmtMoney } from "../helpers";

/* ── Modale de sélection (calquée V1 ShipPickerModal, adaptée tokens V2) ── */

function PickerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-wide transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.1)",
        background: active ? "color-mix(in oklab, var(--accent) 14%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "rgba(255,255,255,0.7)",
      }}
    >
      {children}
    </button>
  );
}

function ShipPickerModal({
  ships,
  mode,
  onPick,
  onClose,
}: {
  ships: CcuShip[];
  mode: "from" | "to";
  onPick: (shipId: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  // Filtre « LTI » : approximation via le flag warbond (un vaisseau multi-SKU avec un SKU
  // warbond moins cher est, le plus souvent, vendu avec LTI). Proxy, pas une garantie.
  const [ltiOnly, setLtiOnly] = useState(false);
  const [manufacturer, setManufacturer] = useState("ALL");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Masque les vaisseaux au nom non résolu (« Ship #id »), dans la modale seulement.
  // Côté CIBLE : n'affiche que les vaisseaux réellement achetables en CCU (au moins un
  // SKU → priceSource === "ccu"). Côté DÉPART : on garde tout (sources incluses).
  const base = useMemo(
    () =>
      ships.filter((s) => {
        if (/^Ship #\d+$/.test(s.name)) return false;
        if (mode === "to" && s.priceSource !== "ccu") return false;
        return true;
      }),
    [ships, mode],
  );

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const s of base) if (s.manufacturer) set.add(s.manufacturer);
    return ["ALL", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [base]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((s) => {
      if (ownedOnly && !s.isOwned) return false;
      if (availableOnly && !s.isAvailable) return false;
      if (ltiOnly && !s.isWarbondPrice) return false;
      if (manufacturer !== "ALL" && s.manufacturer !== manufacturer) return false;
      if (
        q &&
        !(
          s.name.toLowerCase().includes(q) ||
          (s.manufacturer ?? "").toLowerCase().includes(q) ||
          (s.focus ?? "").toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [base, query, ownedOnly, availableOnly, ltiOnly, manufacturer]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.95)", borderColor: "var(--card-border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <span className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)]">
            {mode === "from" ? t('ccu.from') : t('ccu.to')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ccu.close')}
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Recherche + filtres */}
        <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ccu.searchShipPlaceholder')}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <PickerChip active={ownedOnly} onClick={() => setOwnedOnly((v) => !v)}>
              {t('ccu.ownedOnly')}
            </PickerChip>
            <PickerChip active={availableOnly} onClick={() => setAvailableOnly((v) => !v)}>
              {t('ccu.availableOnlyPicker')}
            </PickerChip>
            {mode === "from" && (
              <span title={t('ccu.ltiHint')}>
                <PickerChip active={ltiOnly} onClick={() => setLtiOnly((v) => !v)}>
                  {t('ccu.ltiOnly')}
                </PickerChip>
              </span>
            )}
            <Dropdown
              value={manufacturer}
              onChange={setManufacturer}
              className="w-44"
              buttonClassName="bg-black/30 text-xs text-white/80"
              ariaLabel={t('ccu.allManufacturers')}
              options={manufacturers.map((m) => ({
                value: m,
                label: m === "ALL" ? t('ccu.allManufacturers') : m,
              }))}
            />
            <span className="ml-auto text-[10px] text-white/40">
              {t('ccu.shipsCount', { count: filtered.length })}
            </span>
          </div>
        </div>

        {/* Liste */}
        <div className="overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">{t('ccu.noShipMatch')}</div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.shipId}
                type="button"
                onClick={() => onPick(s.shipId)}
                className="flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-white">{s.name}</span>
                  {s.isOwned && (
                    <span className="ml-2 rounded border border-emerald-400/60 px-1 py-px text-[9px] uppercase tracking-wider text-emerald-400">
                      {t('ccu.owned')}
                    </span>
                  )}
                  <div className="mt-0.5 text-[10px] text-white/40">
                    {s.manufacturer ?? "—"}
                    {s.focus ? ` · ${s.focus}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">
                  {s.priceCents != null ? (
                    <>
                      {fmtMoney(s.priceCents)}
                      {s.priceSource === "msrp" && (
                        <span className="ml-1 text-[9px] font-normal text-white/40">MSRP</span>
                      )}
                      {s.isWarbondPrice && (
                        <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-amber-400">
                          {t('ccu.warbond')}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { PickerChip, ShipPickerModal };
