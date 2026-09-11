import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { type MiningLocation } from "../types";
import { SYSTEM_LABEL, SYSTEM_ORDER, METHOD_KEY, RARITY_KEY } from "../helpers";

/**
 * Modale « où miner » (BP-6b V1). COQUILLE : `get_ingredient_mining_locations` renvoie []
 * tant que ResourceMiningLocation n'est pas peuplée (datamining) → état « données à venir ».
 *
 * POINT DE BRANCHEMENT FUTUR : dès que la commande renverra des lignes, elles s'affichent
 * ici sans refonte (groupées par système, colonnes Corps/Méthode/Rareté).
 *
 * panelMode=true → panneau nu (mode split côte à côte) ; sinon overlay plein écran par-dessus.
 */
function IngredientMiningModal({
  ingredientRef,
  ingredientName,
  panelMode,
  onClose,
}: {
  ingredientRef: string;
  ingredientName: string;
  panelMode: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MiningLocation[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows(null);
    invoke<MiningLocation[]>("get_ingredient_mining_locations", { ingredientRef })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ingredientRef]);

  const groups = useMemo(() => {
    if (!rows) return [] as Array<{ systemName: string; rows: MiningLocation[] }>;
    const map = new Map<string, MiningLocation[]>();
    for (const r of rows) {
      const arr = map.get(r.systemName);
      if (arr) arr.push(r);
      else map.set(r.systemName, [r]);
    }
    const known = SYSTEM_ORDER.filter((s) => map.has(s));
    const extras = [...map.keys()].filter((s) => !SYSTEM_ORDER.includes(s)).sort();
    return [...known, ...extras].map((s) => ({ systemName: s, rows: map.get(s)! }));
  }, [rows]);

  const hasData = !loading && rows !== null && rows.length > 0;
  const cols = "minmax(0,1fr) 108px 116px";

  const content = (
    <>
      <button
        onClick={onClose}
        aria-label={t('crafting.close')}
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-accent/50 hover:text-accent"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header */}
      <header
        className="border-b border-white/10 px-6 py-5"
        style={{
          background:
            "radial-gradient(ellipse at top left, color-mix(in oklab, var(--accent) 10%, transparent), transparent 70%)",
        }}
      >
        <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--amber)" }}>
          {t('crafting.whereToMine')}
        </div>
        <h2 className="mt-1.5 pr-10 text-[22px] font-semibold leading-tight text-white">
          {ingredientName}
        </h2>
        <p className="mt-1 text-[12px] text-white/40">
          {hasData
            ? t('crafting.locationsCount', { count: rows!.length })
            : t('crafting.miningAvailability')}
        </p>
      </header>

      {/* Body */}
      {loading ? (
        <div className="px-8 py-14 text-center text-[12px] uppercase tracking-wider text-white/40">
          {t('crafting.loadingShort')}
        </div>
      ) : !hasData ? (
        <div className="px-8 py-14 text-center text-[12px] leading-relaxed text-white/45">
          {t('crafting.noMiningLocation')}
          <br />
          <span className="text-white/30">{t('crafting.dataComing')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-6 py-5">
          {groups.map((g) => (
            <section
              key={g.systemName}
              className="overflow-hidden rounded-lg border border-white/10 bg-white/5"
            >
              <h3
                className="px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
                style={{
                  background:
                    "linear-gradient(135deg, color-mix(in oklab, var(--accent) 18%, transparent), rgba(255,255,255,0.03))",
                  color: "var(--accent)",
                  borderBottom: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {SYSTEM_LABEL[g.systemName] ?? g.systemName}
              </h3>
              <div
                className="grid items-center gap-2.5 border-b border-white/10 px-3.5 py-2 text-[10px] uppercase tracking-wider text-white/40"
                style={{ gridTemplateColumns: cols }}
              >
                <span>{t('crafting.colBody')}</span>
                <span className="text-center">{t('crafting.colMethod')}</span>
                <span className="text-center">{t('crafting.colRarity')}</span>
              </div>
              <ul>
                {g.rows.map((r, i) => (
                  <li
                    key={`${r.rawBodyKey}-${r.miningMethod}-${i}`}
                    className="grid items-center gap-2.5 border-b border-white/5 px-3.5 py-2.5 last:border-0"
                    style={{ gridTemplateColumns: cols }}
                  >
                    <span className="truncate text-[13px] text-white/85">{r.bodyName}</span>
                    <span className="justify-self-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-center text-[10px] uppercase tracking-wider text-white/70">
                      {METHOD_KEY[r.miningMethod] ? t(METHOD_KEY[r.miningMethod]!) : r.miningMethod}
                    </span>
                    <span className="justify-self-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-center text-[10px] uppercase tracking-wider text-white/70">
                      {r.rarity ? (RARITY_KEY[r.rarity] ? t(RARITY_KEY[r.rarity]!) : r.rarity) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );

  // Mode split (large) : panneau nu côte à côte, pas d'overlay.
  if (panelMode) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full overflow-hidden rounded-2xl border text-[13px] text-white/90"
        style={{
          background: "rgba(18,16,22,0.97)",
          borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
          maxWidth: 760,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        {content}
      </div>
    );
  }

  // Mode étroit : overlay plein écran par-dessus la modale BP (z supérieur, fond plus sombre).
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-5 py-8"
      onClick={onClose}
      style={{ background: "rgba(6,10,16,0.84)", backdropFilter: "blur(5px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[760px] overflow-hidden rounded-2xl border text-[13px] text-white/90"
        style={{
          background: "rgba(18,16,22,0.97)",
          borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        {content}
      </div>
    </div>
  );
}

export { IngredientMiningModal };
