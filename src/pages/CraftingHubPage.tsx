import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Search, X } from "lucide-react";

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

type BlueprintDetail = {
  blueprint: {
    id: string;
    displayName: string;
    category: string;
    producedItemEntityClass: string;
    producedItemName: string | null;
    producedItemDescription: string | null;
    craftTimeSeconds: number | null;
    [key: string]: unknown;
  };
  ingredients: Array<{
    ingredientName: string | null;
    ingredientRef: string;
    ingredientType: string;
    quantity: number;
    slotName: string;
    order: number;
  }>;
  linkedMissions: Array<{
    uuid: string;
    title: string;
    factionName: string | null;
    weight: number;
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
        <BlueprintModal blueprintId={modalBlueprintId} onClose={() => setModalBlueprintId(null)} />
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

function BlueprintModal({ blueprintId, onClose }: { blueprintId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<BlueprintDetail | null>("get_blueprint_detail", { blueprintId })
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
  }, [blueprintId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : error || !detail ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-300">{error ?? "Blueprint introuvable."}</p>
            <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-white">{detail.blueprint.displayName}</h2>
              <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-white/50">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/70">
                {detail.blueprint.category}
              </span>
              <span>⏱ {formatCraftTime(detail.blueprint.craftTimeSeconds)}</span>
            </div>
            <p className="mb-4 break-all text-xs text-white/30">
              {detail.blueprint.producedItemEntityClass}
            </p>

            {/* Ingrédients */}
            <div className="mb-4">
              <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
                Ingrédients ({detail.ingredients.length})
              </p>
              <ul className="flex flex-col gap-1">
                {detail.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-center justify-between text-sm text-white/70">
                    <span className="truncate">
                      {ing.ingredientName ?? ing.ingredientRef}
                      <span className="ml-1 text-xs text-white/30">({ing.ingredientType})</span>
                    </span>
                    <span className="shrink-0 text-white/50">×{ing.quantity}</span>
                  </li>
                ))}
                {detail.ingredients.length === 0 && (
                  <li className="text-sm text-white/30">Aucun ingrédient.</li>
                )}
              </ul>
            </div>

            {/* Missions liées */}
            {detail.linkedMissions.length > 0 && (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
                  Missions liées ({detail.linkedMissions.length})
                </p>
                <ul className="flex flex-col gap-1">
                  {detail.linkedMissions.map((m) => (
                    <li key={m.uuid} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-white/70">
                        {m.title}
                        {m.factionName && (
                          <span className="ml-1 text-xs text-white/40">· {m.factionName}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-amber-400">
                        {(m.weight * 100).toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
