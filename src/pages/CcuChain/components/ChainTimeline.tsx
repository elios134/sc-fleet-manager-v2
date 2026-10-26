import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import { chainNodes, type ChainNode } from "../lib/chain";
import { fmtMoney, fmtMoneyDelta, fmtPct } from "../helpers";
import type { CcuPath, CcuShip } from "../types";

const NODE_BORDER: Record<ChainNode["role"], string> = {
  owned: "border-emerald-400/45 bg-white/[0.04]",
  goal: "border-[var(--accent)]/60 bg-[var(--accent-muted)]",
  step: "border-white/10 bg-white/[0.04]",
};

function Node({ n }: { n: ChainNode }) {
  const { t } = useTranslation();
  const img = resolveShipTopDownUrl(n.name);
  return (
    <div className={`w-[136px] shrink-0 rounded-2xl border p-2.5 ${NODE_BORDER[n.role]}`}>
      <div className="grid h-10 place-items-center overflow-hidden rounded-lg bg-black/20">
        {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-xl text-white/25">⌬</span>}
      </div>
      <b className="mt-2 block truncate text-[13px] text-white">{n.name}</b>
      <span className="text-[11px] tabular-nums text-white/50">{n.priceCents != null ? fmtMoney(n.priceCents) : "—"}</span>
      {n.role === "owned" && <span className="mt-1.5 block w-fit rounded-full border border-emerald-400/40 px-2 py-px text-[10.5px] text-emerald-300">{t("ccu.tagOwned")}</span>}
      {n.role === "goal" && <span className="mt-1.5 block w-fit rounded-full border border-[var(--accent)]/50 px-2 py-px text-[10.5px] text-white">{t("ccu.tagTarget")}</span>}
    </div>
  );
}

function Link({ n }: { n: ChainNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 text-[11px] text-white/50">
      <span className="font-semibold tabular-nums text-white/80">{n.stepCostCents != null ? fmtMoneyDelta(n.stepCostCents) : "?"}</span>
      <span className="relative h-0.5 w-full bg-gradient-to-r from-[var(--accent)]/20 to-[var(--accent)]">
        <span className="absolute -right-px -top-1 border-[5px] border-transparent border-l-[var(--accent)]" />
      </span>
      {n.tag === "warbond" && <span className="text-emerald-300">{t("ccu.tagWarbond")}</span>}
      {n.tag === "standard" && <span>{t("ccu.tagStandard")}</span>}
      {n.limited && (
        <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber-muted)] px-1.5 py-px text-[10px] text-[var(--amber)]">
          {n.stock != null ? t("ccu.wishlist.limitedStock", { count: n.stock }) : t("ccu.wishlist.limited")}
        </span>
      )}
    </div>
  );
}

/** Chemin retenu en frise : vaisseaux (possédé / cible), coût de chaque montée, étiquettes
 *  warbond / standard et stock limité, économie par rapport à la montée directe ; ouvrir RSI, copier le plan. */
export function ChainTimeline({ path, shipsById }: { path: CcuPath; shipsById: Map<number, CcuShip> }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const nodes = chainNodes(path, shipsById);
  const saving = path.savingCents != null && path.savingCents > 0 ? path.savingCents : null;

  function copyPlan() {
    const hops = nodes.slice(1).map((n) => `${n.name} (${fmtMoneyDelta(n.stepCostCents ?? 0)})`);
    void navigator.clipboard.writeText(`${nodes[0]?.name ?? "?"} → ${hops.join(" → ")} | TOTAL: ${fmtMoney(path.totalCostCents)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="glass rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-white">{t("ccu.chosenPath")}</h2>
        <span className="text-sm tabular-nums">
          <b className="text-white">{fmtMoney(path.totalCostCents)}</b>{" "}
          {saving != null ? (
            <span className="font-bold text-emerald-300">
              {t("ccu.savingOf", { amount: fmtMoney(saving) })} <span className="font-normal text-white/40">{fmtPct(-saving, path.directCostCents)}</span>
            </span>
          ) : (
            <span className="text-white/40">{t("ccu.noSaving")}</span>
          )}
        </span>
      </div>
      <div className="mt-3 flex items-stretch overflow-x-auto pb-2">
        {nodes.map((n, i) => (
          <Fragment key={`${n.shipId}-${i}`}>
            {i > 0 && <Link n={n} />}
            <Node n={n} />
          </Fragment>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void openUrl("https://robertsspaceindustries.com/en/account/pledges")} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-[12px] font-semibold text-white hover:brightness-110">
          {t("ccu.openOnRsi")}
        </button>
        <button type="button" onClick={copyPlan} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[12px] text-white/80 hover:bg-white/10">
          {copied ? t("ccu.copied") : t("ccu.copyPlan")}
        </button>
      </div>
    </section>
  );
}
