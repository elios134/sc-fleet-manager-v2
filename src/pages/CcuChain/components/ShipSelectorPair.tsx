import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import { type CcuShip } from "../types";
import { fmtMoney } from "../helpers";

/* ── Panneaux DÉPART / CIBLE (calqués V1 ShipSelectorPair, adaptés tokens V2) ── */

// Vignette top-down Starjump (même mécanisme que Loadout/Comparateur) en bannière large.
// Résolue depuis le NOM ; onError ou non-résoluble → fallback glyphe ⌬ (jamais l'image 3/4).
function PanelTopDown({ name }: { name: string }) {
  const { t } = useTranslation();
  const url = resolveShipTopDownUrl(name);
  const [src, setSrc] = useState<string | null>(url);
  useEffect(() => {
    setSrc(url);
  }, [url]);
  return (
    <div
      className="relative mx-auto mt-3 flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30"
      style={{ aspectRatio: "2.5 / 1", width: "70%" }}
    >
      {src ? (
        <img
          src={src}
          alt={t('ccu.topDownAlt', { name })}
          onError={() => setSrc(null)}
          className="pointer-events-none relative z-10 max-h-[88%] max-w-[92%] select-none object-contain"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-4xl text-white/25">⌬</div>
      )}
    </div>
  );
}

function ShipPanel({
  ship,
  label,
  onChange,
}: {
  ship: CcuShip | null;
  label: string;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">{label}</div>
      <button
        type="button"
        onClick={onChange}
        className="absolute right-3 top-3 z-10 rounded-lg border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {t('ccu.change')}
      </button>

      {ship ? (
        <>
          <PanelTopDown name={ship.name} />
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-white">{ship.name}</span>
              {ship.isOwned && (
                <span className="rounded border border-emerald-400/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-emerald-400">
                  {t('ccu.owned')}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-white/40">
              {ship.manufacturer ?? "—"}
              {ship.focus ? ` · ${ship.focus}` : ""}
            </div>
            <div className="mt-1.5 text-sm font-semibold text-[var(--accent)]">
              {ship.priceCents != null ? (
                <>
                  {fmtMoney(ship.priceCents)}
                  {ship.priceSource === "msrp" && (
                    <span className="ml-1 text-[9px] font-normal text-white/40">MSRP</span>
                  )}
                  {ship.isWarbondPrice && (
                    <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-amber-400">
                      {t('ccu.warbond')}
                    </span>
                  )}
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="py-3 text-sm italic text-white/40">{t('ccu.noShipSelected')}</div>
      )}
    </div>
  );
}

function ShipSelectorPair({
  from,
  to,
  onChangeFrom,
  onChangeTo,
}: {
  from: CcuShip | null;
  to: CcuShip | null;
  onChangeFrom: () => void;
  onChangeTo: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="mt-6 grid items-stretch gap-3"
      style={{ gridTemplateColumns: "1fr 48px 1fr" }}
    >
      <ShipPanel ship={from} label={t('ccu.from')} onChange={onChangeFrom} />
      <div className="grid place-items-center" aria-hidden="true">
        <svg width="32" height="20" viewBox="0 0 32 20" fill="none" stroke="var(--accent)" strokeWidth="2">
          <path d="M2 10 L26 10 M20 4 L26 10 L20 16" />
        </svg>
      </div>
      <ShipPanel ship={to} label={t('ccu.to')} onChange={onChangeTo} />
    </section>
  );
}

export { PanelTopDown, ShipPanel, ShipSelectorPair };
