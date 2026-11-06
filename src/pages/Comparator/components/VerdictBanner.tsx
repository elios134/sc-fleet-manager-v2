import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Rocket } from "lucide-react";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import type { ShipDataRow } from "../compare";
import type { DuelVerdict } from "../lib/verdict";

/** Vue de dessus d'un vaisseau (Starjump) ; icône si absente ou en erreur. */
function ShipTopDown({ name, tone }: { name: string; tone: string }) {
  const { t } = useTranslation();
  const url = resolveShipTopDownUrl(name, "s");
  const [src, setSrc] = useState<string | null>(url);
  useEffect(() => setSrc(url), [url]);
  return (
    <div className="grid aspect-[2.5/1] w-full max-w-[260px] place-items-center overflow-hidden rounded-xl border border-white/10 bg-black/30">
      {src ? (
        <img src={src} alt={t("comparator.topDownAlt", { name })} onError={() => setSrc(null)} className="max-h-[88%] max-w-[92%] object-contain" />
      ) : (
        <Rocket className="h-7 w-7 opacity-25" style={{ color: tone }} />
      )}
    </div>
  );
}

function Side({ side, ship, owned, wins, comparable }: { side: "a" | "b"; ship: ShipDataRow; owned: boolean; wins: number; comparable: number }) {
  const { t } = useTranslation();
  const isA = side === "a";
  const tone = isA ? "var(--accent)" : "var(--rival)";
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${isA ? "items-start" : "items-end text-right"}`}>
      <ShipTopDown name={ship.name} tone={tone} />
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">{ship.manufacturer}</p>
      <p className="text-[20px] font-extrabold leading-tight text-white">{ship.name}</p>
      <p className="text-[12px] text-white/60">{[ship.role, ship.size].filter(Boolean).join(" · ")}</p>
      {owned && <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{t("comparator.inFleet")}</span>}
      <p className="text-[12px] text-white/60">
        <b className="mr-1 text-[20px] font-extrabold tabular-nums" style={{ color: tone }}>{wins}</b>
        {t("comparator.winsOf", { n: comparable })}
      </p>
    </div>
  );
}

/** Bandeau du duel : les deux vaisseaux, leur score et le verdict au centre. */
export function VerdictBanner({
  a,
  b,
  ownedNames,
  winsA,
  winsB,
  verdict,
}: {
  a: ShipDataRow;
  b: ShipDataRow;
  ownedNames: Set<string>;
  winsA: number;
  winsB: number;
  verdict: DuelVerdict;
}) {
  const { t } = useTranslation();
  const owned = (s: ShipDataRow) => ownedNames.has(s.name.toLowerCase());
  return (
    <section className="glass mb-4 grid grid-cols-1 items-center gap-4 rounded-2xl px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <Side side="a" ship={a} owned={owned(a)} wins={winsA} comparable={verdict.total} />
      <p className="text-center text-[15px] font-bold text-white">
        {verdict.winner === "tie"
          ? t("comparator.verdictTie")
          : t("comparator.verdictWin", { ship: verdict.winner === "a" ? a.name : b.name, wins: verdict.wins, total: verdict.total })}
      </p>
      <Side side="b" ship={b} owned={owned(b)} wins={winsB} comparable={verdict.total} />
    </section>
  );
}
