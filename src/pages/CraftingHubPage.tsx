import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Check, Clock, Loader2, Package, Search, X } from "lucide-react";
import { MissionModal, type MissionListItem, type ScopeWithRanks } from "./MissionIntelPage";

/* ── Types (identiques à la V1) ── */

type CraftingHubBlueprintItem = {
  id: string;
  displayName: string;
  displayNameSource: "producedItem" | "name" | "recordName";
  category: string;
  categoryGroupKey: string;
  producedItemEntityClass: string;
  producedItemName: string | null;
  craftTimeSeconds: number | null;
  ingredientCount: number;
  ingredientPreview: string[];
};

type CraftingStats = {
  total: number;
  byCategory: Array<{ category: string; count: number }>;
};

type ItemDetails = {
  description: string | null;
  manufacturer: string | null;
  itemType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  className: string | null;
} | null;

type BlueprintDetail = {
  blueprint: {
    id: string;
    displayName: string;
    displayNameSource: string;
    producedItemName: string | null;
    category: string | null;
    craftTimeSeconds: number | null;
    owned: boolean;
  };
  itemDetails: ItemDetails;
  ingredients: Array<{
    ingredientName: string;
    ingredientRef: string;
    ingredientType: string;
    ingredientTypeLabel: string;
    quantityLabel: string;
    order: number;
  }>;
  linkedMissions: Array<{
    missionUuid: string;
    title: string;
    factionName: string | null;
    weight: number;
    navigable: boolean;
  }>;
};

type OwnedFilter = "all" | "owned" | "remaining";
const ALL = "__all__";
const PAGE_SIZE = 24;

function formatCraftTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

// Numéros de page « 1 2 3 … last » (computePageNumbers indisponible côté V2).
function pageNumbers(current: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) {
      if (out.length > 0 && out[out.length - 1] !== "…" && p - (out[out.length - 1] as number) > 1) {
        out.push("…");
      }
      out.push(p);
    }
  }
  return out;
}

export default function CraftingHubPage() {
  const [items, setItems] = useState<CraftingHubBlueprintItem[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<CraftingStats | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalBlueprintId, setModalBlueprintId] = useState<string | null>(null);

  // ── Mount ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [blueprints, statsData, owned] = await Promise.all([
          invoke<CraftingHubBlueprintItem[]>("list_blueprints"),
          invoke<CraftingStats>("get_crafting_stats"),
          invoke<string[]>("list_blueprint_owned", { accountId: acc }),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setItems(blueprints);
        setStats(statsData);
        setOwnedIds(new Set(owned));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleOwned(blueprintId: string) {
    if (!accountId) return;
    try {
      const res = await invoke<{ owned: boolean }>("toggle_blueprint_owned", {
        accountId,
        blueprintId,
      });
      setOwnedIds((prev) => {
        const next = new Set(prev);
        if (res.owned) next.add(blueprintId);
        else next.delete(blueprintId);
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  // ── Catégories triées (depuis stats.byCategory) ──
  const categories = useMemo(() => {
    if (!stats) return [];
    return [...stats.byCategory].sort((a, b) => a.category.localeCompare(b.category));
  }, [stats]);

  // ── Filtres client ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryFilter !== ALL && it.category !== categoryFilter) return false;
      if (ownedFilter === "owned" && !ownedIds.has(it.id)) return false;
      if (ownedFilter === "remaining" && ownedIds.has(it.id)) return false;
      if (q.length > 0) {
        const hay = `${it.displayName} ${it.producedItemName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, categoryFilter, ownedFilter, ownedIds]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter, ownedFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const ownedCount = ownedIds.size;
  const total = stats?.total ?? 0;
  const ownedProgress = total > 0 ? Math.round((ownedCount / total) * 100) : 0;

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Datamining</p>
        <h1 className="text-2xl font-bold text-white">CRAFTING HUB</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du catalogue…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Erreur : {error}
        </p>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">
            Catalogue vide — synchronisez les données de jeu depuis Settings
          </p>
          <Link
            to="/settings"
            className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Aller dans Settings
          </Link>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mb-6 flex flex-wrap items-center gap-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
            <Stat label="Blueprints" value={String(total)} />
            <Stat label="Possédés" value={String(ownedCount)} accent />
            <Stat label="Restants" value={String(total - ownedCount)} />
            <div className="min-w-[160px] flex-1">
              <div className="mb-1 flex justify-between text-xs text-white/40">
                <span>Progression</span>
                <span>{ownedProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${ownedProgress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Filtres */}
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un blueprint…"
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                />
              </div>

              {/* Segmenté owned */}
              <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                {(["all", "owned", "remaining"] as OwnedFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOwnedFilter(f)}
                    className={[
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      ownedFilter === f ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
                    ].join(" ")}
                  >
                    {f === "all" ? "Tous" : f === "owned" ? "Possédés" : "Restants"}
                  </button>
                ))}
              </div>
            </div>

            {/* Chips catégories */}
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip
                active={categoryFilter === ALL}
                onClick={() => setCategoryFilter(ALL)}
                label="Toutes"
                count={total}
              />
              {categories.map((c) => (
                <CategoryChip
                  key={c.category}
                  active={categoryFilter === c.category}
                  onClick={() => setCategoryFilter(c.category)}
                  label={c.category}
                  count={c.count}
                />
              ))}
            </div>
          </div>

          {/* Grille */}
          {filtered.length === 0 ? (
            <p className="text-sm text-white/40">Aucun blueprint ne correspond aux filtres.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageItems.map((it) => (
                <BlueprintCard
                  key={it.id}
                  item={it}
                  owned={ownedIds.has(it.id)}
                  onToggleOwned={() => toggleOwned(it.id)}
                  onClick={() => setModalBlueprintId(it.id)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <PageBtn disabled={safePage === 1} onClick={() => setCurrentPage(safePage - 1)}>
                ‹
              </PageBtn>
              {pageNumbers(safePage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`d-${i}`} className="px-1 text-white/30">
                    …
                  </span>
                ) : (
                  <PageBtn key={p} active={p === safePage} onClick={() => setCurrentPage(p)}>
                    {p}
                  </PageBtn>
                ),
              )}
              <PageBtn disabled={safePage === totalPages} onClick={() => setCurrentPage(safePage + 1)}>
                ›
              </PageBtn>
            </div>
          )}
        </>
      )}

      {modalBlueprintId && (
        <BlueprintModal
          blueprintId={modalBlueprintId}
          accountId={accountId}
          isOwned={ownedIds.has(modalBlueprintId)}
          onToggleOwned={() => toggleOwned(modalBlueprintId)}
          onClose={() => setModalBlueprintId(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-white/40">{label}</p>
      <p className={accent ? "text-xl font-bold text-[var(--accent)]" : "text-xl font-bold text-white"}>
        {value}
      </p>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-indigo-500/30 bg-indigo-500/20 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
    >
      {label}
      <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-white/60">
        {count}
      </span>
    </button>
  );
}

function PageBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm transition-colors disabled:opacity-30",
        active
          ? "border-indigo-500/30 bg-indigo-500/20 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function BlueprintCard({
  item,
  owned,
  onToggleOwned,
  onClick,
}: {
  item: CraftingHubBlueprintItem;
  owned: boolean;
  onToggleOwned: () => void;
  onClick: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className="flex cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-white" title={item.displayName}>
          {item.displayName}
        </h3>
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">
          {item.category}
        </span>
      </div>

      <p className="mt-2 text-xs text-white/40">{item.ingredientCount} ingrédient(s)</p>
      {item.ingredientPreview.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-white/50" title={item.ingredientPreview.join(" + ")}>
          {item.ingredientPreview.join(" + ")}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-white/40">⏱ {formatCraftTime(item.craftTimeSeconds)}</span>
        <label
          className="flex items-center gap-1.5 text-xs text-white/70"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={owned}
            onChange={onToggleOwned}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Possédé
        </label>
      </div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-white/40">{label}</span>
      <span className="text-right text-white/80">{value}</span>
    </div>
  );
}

// Carte stat en MODE FALLBACK MÉTA (label uppercase + valeur dorée).
// Le mode réactif (delta badge + valeur calculée) sera branché avec producedItemStatsJson.
function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</span>
      <span className="truncate text-[16px] tabular-nums" style={{ color: "#fbbf24" }}>
        {value}
      </span>
    </div>
  );
}

// Vue large (≥1280px) → mode split côte à côte ; sinon modale « où miner » par-dessus.
function useIsWide(query = "(min-width: 1280px)"): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

type MiningLocation = {
  systemName: string;
  rawBodyKey: string;
  bodyName: string;
  miningMethod: string;
  rarity: string | null;
};

const SYSTEM_LABEL: Record<string, string> = { stanton: "Stanton", pyro: "Pyro", nyx: "Nyx" };
const SYSTEM_ORDER = ["stanton", "pyro", "nyx"];
const METHOD_LABEL: Record<string, string> = {
  fps: "FPS",
  ground_vehicle: "Véhicule",
  ship: "Vaisseau",
};
const RARITY_LABEL: Record<string, string> = {
  common: "Commune",
  uncommon: "Peu commune",
  rare: "Rare",
  epic: "Épique",
  legendary: "Légendaire",
};

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
        aria-label="Fermer"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-amber-400/50 hover:text-amber-300"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header */}
      <header
        className="border-b border-white/10 px-6 py-5"
        style={{
          background:
            "radial-gradient(ellipse at top left, rgba(245,158,11,0.10), transparent 70%)",
        }}
      >
        <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--amber)" }}>
          Où miner
        </div>
        <h2 className="mt-1.5 pr-10 text-[22px] font-semibold leading-tight text-white">
          {ingredientName}
        </h2>
        <p className="mt-1 text-[12px] text-white/40">
          {hasData ? `${rows!.length} localisation(s)` : "Disponibilité minière"}
        </p>
      </header>

      {/* Body */}
      {loading ? (
        <div className="px-8 py-14 text-center text-[12px] uppercase tracking-wider text-white/40">
          Chargement…
        </div>
      ) : !hasData ? (
        <div className="px-8 py-14 text-center text-[12px] leading-relaxed text-white/45">
          Aucune localisation de minage disponible
          <br />
          <span className="text-white/30">(données à venir)</span>
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
                    "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(255,255,255,0.03))",
                  color: "#fbbf24",
                  borderBottom: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {SYSTEM_LABEL[g.systemName] ?? g.systemName}
              </h3>
              <div
                className="grid items-center gap-2.5 border-b border-white/10 px-3.5 py-2 text-[10px] uppercase tracking-wider text-white/40"
                style={{ gridTemplateColumns: cols }}
              >
                <span>Corps</span>
                <span className="text-center">Méthode</span>
                <span className="text-center">Rareté</span>
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
                      {METHOD_LABEL[r.miningMethod] ?? r.miningMethod}
                    </span>
                    <span className="justify-self-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-center text-[10px] uppercase tracking-wider text-white/70">
                      {r.rarity ? (RARITY_LABEL[r.rarity] ?? r.rarity) : "—"}
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
          borderColor: "rgba(245,158,11,0.30)",
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
          borderColor: "rgba(245,158,11,0.30)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        {content}
      </div>
    </div>
  );
}

function BlueprintModal({
  blueprintId,
  accountId,
  isOwned,
  onToggleOwned,
  onClose,
}: {
  blueprintId: string;
  accountId: string;
  isOwned: boolean;
  onToggleOwned: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mission liée ouverte par-dessus (réutilise la modale Mission Intel).
  const [selectedMissionUuid, setSelectedMissionUuid] = useState<string | null>(null);
  // Ingrédient dont on affiche les localisations de minage (modale « où miner »).
  const [miningIngredient, setMiningIngredient] = useState<{ ref: string; name: string } | null>(
    null,
  );
  const isWide = useIsWide();
  const splitMode = isWide && miningIngredient !== null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<BlueprintDetail | null>("get_blueprint_detail", { blueprintId, accountId })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, accountId]);

  const it = detail?.itemDetails ?? null;

  // Panneau BP factorisé : rendu centré (normal) OU en colonne gauche (mode split).
  const bpPanel = (
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative w-full max-w-[880px] overflow-hidden rounded-2xl border text-[13px] text-white/90"
      style={{
        background: "rgba(18,16,22,0.97)",
        borderColor: "rgba(245,158,11,0.30)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
      }}
    >
          {/* Fermeture (coin haut-droite) */}
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-amber-400/50 hover:text-amber-300"
          >
            <X className="h-4 w-4" />
          </button>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-8 py-20 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : error || !detail ? (
            <div className="px-8 py-20 text-center text-sm text-red-300">
              {error ?? "Blueprint introuvable."}
            </div>
          ) : (
            <>
              {/* ── En-tête (grid 3 colonnes : icône | texte | possédé) ── */}
              <header
                className="grid grid-cols-[auto_1fr_auto] items-start gap-4 border-b border-white/10 px-6 py-5"
                style={{
                  background:
                    "radial-gradient(ellipse at top right, rgba(245,158,11,0.10), transparent 70%)",
                }}
              >
                {/* Icône (placeholder doré — icônes par type au Lot 3) */}
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(194,119,63,0.30), rgba(255,255,255,0.04))",
                    color: "#fbbf24",
                  }}
                >
                  <Package className="h-7 w-7" />
                </div>

                {/* Centre */}
                <div className="min-w-0 pr-2">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {detail.blueprint.category && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-wider text-white/70">
                        {detail.blueprint.category}
                      </span>
                    )}
                    {detail.blueprint.craftTimeSeconds != null && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums"
                        style={{ borderColor: "rgba(251,191,36,0.30)", color: "#fbbf24" }}
                      >
                        <Clock className="h-3 w-3" />
                        {formatCraftTime(detail.blueprint.craftTimeSeconds)}
                      </span>
                    )}
                  </div>

                  <h2
                    className="text-[22px] font-semibold leading-tight text-white"
                    style={{
                      fontStyle:
                        detail.blueprint.displayNameSource === "recordName" ? "italic" : "normal",
                    }}
                    title={detail.blueprint.displayName}
                  >
                    {detail.blueprint.displayName}
                    {detail.blueprint.displayNameSource === "recordName" && (
                      <span className="text-white/30"> ?</span>
                    )}
                  </h2>

                  <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-white/40">
                    {[detail.blueprint.category, it?.size != null ? `S${it.size}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>

                  {/* Bloc Type/Sous-type/Fabricant/Taille/Grade/Classe (itemDetails API) */}
                  {it && (
                    <div className="mt-3 flex flex-col gap-1">
                      <DetailRow label="Type" value={it.itemType} />
                      <DetailRow label="Sous-type" value={it.subType} />
                      <DetailRow label="Fabricant" value={it.manufacturer} />
                      <DetailRow label="Taille" value={it.size != null ? `S${it.size}` : null} />
                      <DetailRow label="Grade" value={it.grade} />
                      <DetailRow label="Classe" value={it.className} />
                    </div>
                  )}

                  {it?.description && (
                    <p className="mt-2.5 whitespace-pre-wrap text-[12px] leading-relaxed text-white/55">
                      {it.description}
                    </p>
                  )}
                </div>

                {/* Bouton Possédé (droite ; mr pour dégager la croix) */}
                <button
                  onClick={onToggleOwned}
                  className={[
                    "mr-8 inline-flex items-center gap-2 self-start rounded-lg border px-4 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors",
                    isOwned
                      ? "border-emerald-500/50 text-emerald-300"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-emerald-500/40 hover:text-emerald-300",
                  ].join(" ")}
                  style={
                    isOwned
                      ? {
                          background: "rgba(16,185,129,0.18)",
                          boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.30)",
                        }
                      : undefined
                  }
                >
                  {isOwned ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Possédé
                    </>
                  ) : (
                    "Marquer comme obtenu"
                  )}
                </button>
              </header>

              {/* ── Rangée de stat cards — MODE FALLBACK MÉTA (4 cartes, données réelles).
                   POINT DE BRANCHEMENT FUTUR (a) : passer en mode réactif (1 carte par stat
                   + delta badge) quand get_blueprint_detail renverra stats[] non vide. ── */}
              <section
                className="grid gap-2.5 border-b border-white/10 px-6 py-4"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
              >
                <MetaStat label="Type" value={it?.itemType ?? detail.blueprint.category ?? "—"} />
                <MetaStat label="Taille" value={it?.size != null ? `S${it.size}` : "—"} />
                <MetaStat
                  label="Temps de craft"
                  value={formatCraftTime(detail.blueprint.craftTimeSeconds)}
                />
                <MetaStat label="Ingrédients" value={String(detail.ingredients.length)} />
              </section>

              {/* ── Recette ── */}
              <section className="border-b border-white/10 px-6 py-4">
                <h3
                  className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--amber)" }}
                >
                  Recette
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tracking-normal text-white/40">
                    {detail.ingredients.length}
                  </span>
                </h3>
                {detail.ingredients.length === 0 ? (
                  <p className="text-[12px] italic text-white/30">Aucun ingrédient.</p>
                ) : (
                  <div className="grid gap-3.5" style={{ gridTemplateColumns: "140px 1fr" }}>
                    {/* Slot unique « Recette » (écart #2) */}
                    <div
                      className="pt-2 text-[11px] uppercase tracking-[0.1em]"
                      style={{ color: "#c2773f" }}
                    >
                      Recette
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {detail.ingredients.map((ing, i) => (
                        <div
                          key={i}
                          className="grid items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                          style={{
                            gridTemplateColumns: "minmax(0,1.4fr) 80px 70px minmax(120px,1fr)",
                          }}
                        >
                          {/* nom cliquable → modale « où miner » (souligné pointillé + ↗) */}
                          <button
                            type="button"
                            onClick={() =>
                              setMiningIngredient({ ref: ing.ingredientRef, name: ing.ingredientName })
                            }
                            title="Voir où miner"
                            className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-white/85 transition-colors hover:text-amber-300"
                            style={{
                              textDecoration: "underline dotted rgba(245,158,11,0.5)",
                              textUnderlineOffset: "3px",
                            }}
                          >
                            <span className="truncate">{ing.ingredientName}</span>
                            <ArrowUpRight className="h-3 w-3 shrink-0 text-white/40" />
                          </button>
                          {/* badge type */}
                          <span
                            className={[
                              "rounded-full border px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wider",
                              ing.ingredientType === "resource"
                                ? "border-emerald-500/35 text-emerald-300/90"
                                : "border-amber-400/30 text-amber-300",
                            ].join(" ")}
                          >
                            {ing.ingredientTypeLabel}
                          </span>
                          {/* quantité */}
                          <span
                            className="text-right text-[12px] tabular-nums"
                            style={{ color: "#fbbf24" }}
                          >
                            {ing.quantityLabel}
                          </span>
                          {/* slider de qualité — REPRODUIT mais INERTE.
                              POINT DE BRANCHEMENT FUTUR (b) : retirer l'état inerte et piloter
                              la qualité (0-1000) quand producedItemStatsJson sera alimenté. */}
                          <label
                            className="flex items-center gap-2"
                            style={{ opacity: 0.45, pointerEvents: "none" }}
                          >
                            <input
                              type="range"
                              min={0}
                              max={1000}
                              step={10}
                              value={500}
                              readOnly
                              disabled
                              className="h-1 flex-1 cursor-not-allowed accent-amber-400"
                            />
                            <span className="min-w-[56px] text-right text-[9px] uppercase tracking-[0.1em] text-white/40">
                              Qualité · 500
                            </span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* ── Missions de déblocage (cliquables → modale Mission Intel) ── */}
              {detail.linkedMissions.length > 0 && (
                <section className="px-6 py-4">
                  <h3
                    className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: "var(--amber)" }}
                  >
                    Missions de déblocage
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tracking-normal text-white/40">
                      {detail.linkedMissions.length}
                    </span>
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {detail.linkedMissions.map((m) => (
                      <li key={m.missionUuid}>
                        <button
                          type="button"
                          disabled={!m.navigable}
                          onClick={() => m.navigable && setSelectedMissionUuid(m.missionUuid)}
                          className={[
                            "flex w-full items-center justify-between gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                            m.navigable
                              ? "border-white/10 bg-white/5 hover:border-amber-700/50 hover:bg-white/[0.08]"
                              : "cursor-default border-white/5 bg-white/[0.02]",
                          ].join(" ")}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-[13px] text-white/90">{m.title}</span>
                            {m.factionName && (
                              <span className="text-[10px] uppercase tracking-[0.08em] text-white/40">
                                {m.factionName}
                              </span>
                            )}
                          </span>
                          <span
                            className="shrink-0 text-[12px] tabular-nums"
                            style={{ color: "#c2773f" }}
                          >
                            ×{m.weight.toFixed(2)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
        onClick={onClose}
        style={{
          background: "rgba(8,5,3,0.78)",
          backdropFilter: "blur(4px)",
          padding: splitMode ? 0 : "2rem 1.25rem",
        }}
      >
        {splitMode && miningIngredient ? (
          // Mode split (large) : BP à gauche (55%), panneau « où miner » à droite.
          <div
            className="flex w-full max-w-[1600px] items-start gap-4 px-5 py-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0" style={{ flex: "0 0 55%", maxWidth: 880 }}>
              {bpPanel}
            </div>
            <IngredientMiningModal
              ingredientRef={miningIngredient.ref}
              ingredientName={miningIngredient.name}
              panelMode
              onClose={() => setMiningIngredient(null)}
            />
          </div>
        ) : (
          bpPanel
        )}
      </div>

      {/* Mode étroit : modale « où miner » par-dessus la modale BP */}
      {!splitMode && miningIngredient && (
        <IngredientMiningModal
          ingredientRef={miningIngredient.ref}
          ingredientName={miningIngredient.name}
          panelMode={false}
          onClose={() => setMiningIngredient(null)}
        />
      )}

      {/* Modale Mission Intel réutilisée, par-dessus (sibling → ne ferme pas la modale BP) */}
      {selectedMissionUuid && (
        <MissionModalLoader
          missionUuid={selectedMissionUuid}
          accountId={accountId}
          onClose={() => setSelectedMissionUuid(null)}
        />
      )}
    </>
  );
}

/**
 * Charge la mission complète (+ scopes, état objectif/favori) puis rend la modale
 * Mission Intel EXISTANTE. La mission liée d'un blueprint est toujours en base
 * (jointure côté backend), donc trouvée par uuid.
 */
function MissionModalLoader({
  missionUuid,
  accountId,
  onClose,
}: {
  missionUuid: string;
  accountId: string;
  onClose: () => void;
}) {
  const [mission, setMission] = useState<MissionListItem | null>(null);
  const [scopes, setScopes] = useState<ScopeWithRanks[]>([]);
  const [objectiveUuids, setObjectiveUuids] = useState<Set<string>>(new Set());
  const [favoriteUuids, setFavoriteUuids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [missions, scopesData, objs, favs] = await Promise.all([
          invoke<MissionListItem[]>("list_missions", { types: [], factions: [] }),
          invoke<ScopeWithRanks[]>("get_scopes"),
          invoke<Array<{ uuid: string }>>("list_objectives", { accountId }),
          invoke<Array<{ uuid: string }>>("list_favorites", { accountId }),
        ]);
        if (cancelled) return;
        setMission(missions.find((m) => m.uuid === missionUuid) ?? null);
        setScopes(scopesData);
        setObjectiveUuids(new Set(objs.map((o) => o.uuid)));
        setFavoriteUuids(new Set(favs.map((f) => f.uuid)));
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionUuid, accountId]);

  async function toggleObjective() {
    if (!accountId) return;
    await invoke("toggle_objective", { accountId, missionUuid });
    const objs = await invoke<Array<{ uuid: string }>>("list_objectives", { accountId });
    setObjectiveUuids(new Set(objs.map((o) => o.uuid)));
  }
  async function toggleFavorite() {
    if (!accountId) return;
    await invoke("toggle_favorite", { accountId, missionUuid });
    const favs = await invoke<Array<{ uuid: string }>>("list_favorites", { accountId });
    setFavoriteUuids(new Set(favs.map((f) => f.uuid)));
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 flex items-center gap-2 text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la mission…
        </div>
      </div>
    );
  }
  if (!mission) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 rounded-xl border border-white/10 bg-[rgba(20,20,28,0.95)] px-5 py-4 text-sm text-white/60"
        >
          Mission introuvable dans la base locale.
        </div>
      </div>
    );
  }

  return (
    <MissionModal
      mission={mission}
      scopes={scopes}
      accountId={accountId}
      isObjective={objectiveUuids.has(mission.uuid)}
      isFavorite={favoriteUuids.has(mission.uuid)}
      onToggleObjective={() => void toggleObjective()}
      onToggleFavorite={() => void toggleFavorite()}
      onClose={onClose}
    />
  );
}
