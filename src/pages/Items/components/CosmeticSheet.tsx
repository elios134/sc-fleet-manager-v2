import { useNavigate } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { ExternalLink, Package } from "lucide-react";
import type { HangarItem } from "../types";
import { cosmeticKind, inFleet, shipOfTitle } from "../lib/cosmetics";
import { KIND_UI } from "../helpers";
import { CosmeticThumb } from "./CosmeticThumb";

const RSI_PLEDGES = "https://robertsspaceindustries.com/en/account/pledges";
const caption = "mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/40";
const row = "flex items-center justify-between gap-3 border-b border-white/[0.06] py-1.5 text-[13px]";

/** Fiche d'un objet : image, type, pack d'origine (valeur, date), vaisseau concerné. */
export function CosmeticSheet({ item, fleetNames }: { item: HangarItem; fleetNames: string[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const kind = KIND_UI[cosmeticKind(item)];
  const ship = shipOfTitle(item.title);
  const owned = ship ? inFleet(ship, fleetNames) : false;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CosmeticThumb imageUrl={item.imageUrl} className="aspect-video w-full rounded-xl" glyph={64} />
        <h2 className="mt-4 text-xl font-bold text-white">{item.title}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 py-0.5 text-[11px] text-white">
            <kind.Icon className="h-3 w-3" /> {t(kind.labelKey)}
          </span>
          {item.manufacturer && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60">{item.manufacturer}</span>}
        </div>

        <p className={caption}>{t("items.packOrigin")}</p>
        <p className="text-[13px] text-white/85">{item.pledgeName ?? "—"}</p>
        <div className={row}>
          <span className="text-white/45">{t("items.packValue")}</span>
          <b className="tabular-nums text-white">{item.pledgeValueUsd != null ? `${item.pledgeValueUsd} $` : "—"}</b>
        </div>
        <div className={row}>
          <span className="text-white/45">{t("items.packDate")}</span>
          <span className="text-white/80">{item.pledgeCreatedDate ?? "—"}</span>
        </div>

        {ship && (
          <>
            <p className={caption}>{t("items.forShip")}</p>
            <div className={row}>
              <span className="text-white/85">{ship}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${owned ? "border-emerald-400/40 text-emerald-300" : "border-[var(--amber)]/45 text-[var(--amber)]"}`}>
                {t(owned ? "items.inFleet" : "items.notInFleet")}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex shrink-0 gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={() => navigate(`/pack/${item.pledgeId}`)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
        >
          <Package className="h-4 w-4" /> {t("items.viewPack")}
        </button>
        <button
          type="button"
          onClick={() => void openUrl(RSI_PLEDGES).catch(() => {})}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
        >
          <ExternalLink className="h-4 w-4" /> {t("items.openRsi")}
        </button>
      </div>
    </div>
  );
}
