import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Search, X } from "lucide-react";

/* ── Types ── */

type HangarItem = {
  id: number;
  pledgeId: number;
  accountId: string;
  title: string;
  kind: string | null;
  imageUrl: string | null;
  manufacturer: string | null;
  pledgeName: string | null;
};

type PledgeGroup = {
  id: number; // pledgeId
  name: string;
  items: HangarItem[];
};

const PER_PAGE = 6;

// Kinds avec un chip dédié ; tout le reste (et kind === null) tombe sous « Autre ».
const KNOWN_KINDS = new Set(["FPS Equipment", "Skin", "Component", "Hangar decoration"]);
type KindFilter = "ALL" | "FPS Equipment" | "Skin" | "Component" | "Hangar decoration" | "OTHER";

// Libellés FR des kinds RSI (V2 n'a pas d'i18n ; cf. itemHelpers V1).
const KIND_LABELS: Record<string, string> = {
  "FPS Equipment": "Équipement FPS",
  Skin: "Skin",
  Component: "Composant",
  "Hangar decoration": "Décoration hangar",
};

function kindLabel(kind: string | null): string | null {
  if (!kind) return null;
  return KIND_LABELS[kind] ?? kind;
}

// Normalise une URL d'image RSI (réplique utils/rsiImageUrl.ts V1).
function normalizeRsiImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) return `https://robertsspaceindustries.com${trimmed}`;
  return null;
}

// Un pledge matche un filtre kind si AU MOINS UN de ses items qualifie.
function pledgeMatchesKind(p: PledgeGroup, filter: KindFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "OTHER")
    return p.items.some((it) => it.kind === null || !KNOWN_KINDS.has(it.kind));
  return p.items.some((it) => it.kind === filter);
}

// Numéros de page « 1 2 3 … last » (même logique que CraftingHubPage).
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

const CHIPS: ReadonlyArray<readonly [string, KindFilter]> = [
  ["Tous", "ALL"],
  ["Équipement FPS", "FPS Equipment"],
  ["Skin", "Skin"],
  ["Composant", "Component"],
  ["Décoration hangar", "Hangar decoration"],
  ["Autre", "OTHER"],
];

export default function ItemsCosmeticsPage() {
  const location = useLocation();
  const [groups, setGroups] = useState<PledgeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [search, setSearch] = useState("");
  const [activeKind, setActiveKind] = useState<KindFilter>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const [openPackage, setOpenPackage] = useState<PledgeGroup | null>(null);
  const [openSingle, setOpenSingle] = useState<{ item: HangarItem; pledgeName: string } | null>(
    null,
  );

  // Recharge après une synchronisation RSI (événement émis par Settings).
  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((t) => t + 1));
    return () => {
      void pending.then((un) => un());
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setNoAccount(true);
        return;
      }
      const rows = await invoke<HangarItem[]>("get_hangar_items", { accountId });
      // Groupage par pledgeId, en préservant l'ordre alphabétique des titres (déjà trié SQL).
      const byPledge = new Map<number, PledgeGroup>();
      for (const it of rows) {
        let g = byPledge.get(it.pledgeId);
        if (!g) {
          g = { id: it.pledgeId, name: it.pledgeName ?? `Pledge #${it.pledgeId}`, items: [] };
          byPledge.set(it.pledgeId, g);
        }
        g.items.push(it);
      }
      setNoAccount(false);
      setGroups([...byPledge.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.key, reloadTick]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeKind]);

  // Recherche : nom du pledge + titre / kind / manufacturer de n'importe quel item.
  const matchesSearch = useCallback(
    (p: PledgeGroup) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.items.some(
          (it) =>
            it.title.toLowerCase().includes(q) ||
            (it.kind?.toLowerCase().includes(q) ?? false) ||
            (it.manufacturer?.toLowerCase().includes(q) ?? false),
        )
      );
    },
    [search],
  );

  const filtered = useMemo(
    () => groups.filter((p) => matchesSearch(p) && pledgeMatchesKind(p, activeKind)),
    [groups, matchesSearch, activeKind],
  );

  // Compteurs de chips indépendants de la recherche (reflètent tout le hangar).
  const chips = CHIPS.map(([label, kind]) => ({
    label,
    kind,
    count: groups.filter((p) => pledgeMatchesKind(p, kind)).length,
    active: activeKind === kind,
  }));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageGroups = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  if (!loading && noAccount) {
    return (
      <div className="p-8">
        <p className="text-white/50">
          Aucun compte actif.{" "}
          <Link to="/" className="text-[var(--accent)] hover:underline">
            Sélectionner un commandant
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Hangar</p>
        <h1 className="text-2xl font-bold text-white">ITEMS &amp; COSMETICS</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des items…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Erreur : {error}
        </p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">
            Aucun item — synchronisez votre hangar RSI depuis Settings
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
          {/* Filtres */}
          <div className="mb-5 flex flex-col gap-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un item…"
                className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <KindChip
                  key={c.kind}
                  active={c.active}
                  onClick={() => setActiveKind(c.kind)}
                  label={c.label}
                  count={c.count}
                />
              ))}
            </div>
          </div>

          {/* Grille */}
          {filtered.length === 0 ? (
            <p className="text-sm text-white/40">Aucun item ne correspond aux filtres.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageGroups.map((p) =>
                p.items.length > 1 ? (
                  <ItemPackageCard key={`pkg-${p.id}`} pledge={p} onView={() => setOpenPackage(p)} />
                ) : (
                  <ItemCard
                    key={`item-${p.id}`}
                    item={p.items[0]!}
                    onClick={() => setOpenSingle({ item: p.items[0]!, pledgeName: p.name })}
                  />
                ),
              )}
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
              <PageBtn
                disabled={safePage === totalPages}
                onClick={() => setCurrentPage(safePage + 1)}
              >
                ›
              </PageBtn>
            </div>
          )}
        </>
      )}

      {openPackage && (
        <ItemPackageModal pledge={openPackage} onClose={() => setOpenPackage(null)} />
      )}
      {openSingle && (
        <ItemDetailsModal
          item={openSingle.item}
          pledgeName={openSingle.pledgeName}
          onClose={() => setOpenSingle(null)}
        />
      )}
    </div>
  );
}

/* ── Placeholder glyph (items sans image) ── */
function ItemGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 3 7v10l9 5 9-5V7Z" />
      <path d="M3 7l9 5 9-5M12 12v10" />
    </svg>
  );
}

function KindChip({
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

/* ── Carte item unique ── */
function ItemCard({ item, onClick }: { item: HangarItem; onClick: () => void }) {
  const label = kindLabel(item.kind);
  const img = normalizeRsiImageUrl(item.imageUrl);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition-colors hover:bg-white/10"
    >
      <div className="relative flex h-32 w-full items-center justify-center bg-white/5">
        {img ? (
          <img src={img} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <span className="text-white/30">
            <ItemGlyph size={34} />
          </span>
        )}
        {label && (
          <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80">
            {label}
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="truncate font-medium text-white" title={item.title}>
          {item.title}
        </h3>
        {item.manufacturer && (
          <p className="truncate text-xs text-white/40">{item.manufacturer}</p>
        )}
      </div>
    </button>
  );
}

/* ── Carte package (pledge multi-items) ── */
function ItemPackageCard({ pledge, onView }: { pledge: PledgeGroup; onView: () => void }) {
  const count = pledge.items.length;
  const heroImg = normalizeRsiImageUrl(pledge.items.find((it) => it.imageUrl)?.imageUrl ?? null);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="relative flex h-32 w-full items-center justify-center bg-white/5">
        <span className="absolute right-2 top-2 rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
          {count}
        </span>
        {heroImg ? (
          <img src={heroImg} alt={pledge.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-white/30">
            <ItemGlyph size={40} />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="truncate font-medium text-white" title={pledge.name}>
          {pledge.name}
        </h3>
        <p className="text-xs text-white/40">{count} items</p>
        <button
          type="button"
          onClick={onView}
          className="mt-3 self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
        >
          Voir le contenu
        </button>
      </div>
    </div>
  );
}

/* ── Modale détail item ── */
function ItemDetailsModal({
  item,
  pledgeName,
  onClose,
}: {
  item: HangarItem;
  pledgeName: string;
  onClose: () => void;
}) {
  const label = kindLabel(item.kind);
  const img = normalizeRsiImageUrl(item.imageUrl);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex h-48 w-full items-center justify-center bg-white/5">
          {img ? (
            <img src={img} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <span className="text-white/30">
              <ItemGlyph size={56} />
            </span>
          )}
        </div>
        <div className="p-5">
          {label && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">
              {label}
            </span>
          )}
          <h2 className="mt-2 text-lg font-bold text-white">{item.title}</h2>
          {item.manufacturer && <p className="text-sm text-white/50">{item.manufacturer}</p>}
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="text-xs uppercase tracking-wider text-white/40">Pledge source</p>
            <p className="text-sm text-white/70">{pledgeName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Modale package (liste des items) ── */
function ItemPackageModal({ pledge, onClose }: { pledge: PledgeGroup; onClose: () => void }) {
  const [selected, setSelected] = useState<HangarItem | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
          style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{pledge.name}</h2>
              <p className="text-sm text-white/40">{pledge.items.length} items</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-white/60 hover:bg-white/10"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {pledge.items.map((it) => {
              const label = kindLabel(it.kind);
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
                      <ItemGlyph size={20} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">
                      {it.title}
                    </span>
                    {it.manufacturer && (
                      <span className="block truncate text-xs text-white/40">
                        {it.manufacturer}
                      </span>
                    )}
                  </span>
                  {label && (
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
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
        <ItemDetailsModal
          item={selected}
          pledgeName={pledge.name}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
