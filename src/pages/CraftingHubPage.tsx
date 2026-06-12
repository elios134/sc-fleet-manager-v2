import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  Atom,
  Backpack,
  Check,
  Clock,
  Crosshair,
  Fan,
  HardHat,
  Loader2,
  Magnet,
  Package,
  Pickaxe,
  Plug,
  Radar,
  Recycle,
  Search,
  Shield,
  Shirt,
  Target,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { MissionModal, type MissionListItem, type ScopeWithRanks } from "./MissionIntelPage";
import {
  computeStackedStatValue,
  formatDeltaBadge,
  formatStatDisplay,
  type BlueprintStat,
} from "../lib/craftingStats";

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
  stats: BlueprintStat[];
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

/* ── Regroupement en familles FR (calque V1) ──
 * V1 groupe via BlueprintCategoryRecord ; en V2 on dérive la famille depuis output.type
 * (colonne `category`), à la volée côté front (pas de re-sync). Ordre V1 conservé. */
type Family =
  | "Armures FPS"
  | "Armes FPS"
  | "Composants vaisseau"
  | "Armes vaisseau"
  | "Objets mission"
  | "Autres";

const FAMILY_ORDER: Family[] = [
  "Armures FPS",
  "Armes FPS",
  "Composants vaisseau",
  "Armes vaisseau",
  "Objets mission",
  "Autres",
];

const SHIP_WEAPON_TYPES = new Set([
  "WeaponGun",
  "Turret",
  "WeaponDefensive",
  "Missile",
  "MissileLauncher",
  "Ordnance",
  "Bomb",
]);

// Types vaisseau connus (pour signaler ceux qui tombent par défaut sans être listés).
const KNOWN_SHIP_COMPONENT_TYPES = new Set([
  "Cooler",
  "Shield",
  "PowerPlant",
  "QuantumDrive",
  "Radar",
  "Scanner",
  "DockingCollar",
  "TractorBeam",
  "FuelIntake",
  "FuelTank",
  "MiningModifier",
  "SalvageModifier",
  "QuantumInterdictionGenerator",
  "EMP",
  "SelfDestruct",
]);

function familyOf(type: string): Family {
  if (!type) return "Autres";
  if (type.startsWith("Char_Armor")) return "Armures FPS";
  if (type.startsWith("WeaponPersonal") || type === "Gadget") return "Armes FPS";
  if (SHIP_WEAPON_TYPES.has(type)) return "Armes vaisseau";
  if (type === "MissionItem" || type.startsWith("Mission")) return "Objets mission";
  // Reste = matériel vaisseau (famille la plus proche). Les types inconnus sont signalés.
  return "Composants vaisseau";
}

// Icône par type (calque l'esprit de getBlueprintIconKey V1, mappé sur output.type V2).
function getBlueprintIcon(type: string): LucideIcon {
  if (type.startsWith("Char_Armor_Helmet")) return HardHat;
  if (type.startsWith("Char_Armor_Backpack")) return Backpack;
  if (type.startsWith("Char_Armor")) return Shirt;
  switch (type) {
    case "Shield":
      return Shield;
    case "Cooler":
      return Fan;
    case "PowerPlant":
      return Zap;
    case "QuantumDrive":
      return Atom;
    case "Radar":
    case "Scanner":
      return Radar;
    case "DockingCollar":
      return Plug;
    case "WeaponGun":
    case "Turret":
    case "WeaponDefensive":
      return Target;
    case "WeaponPersonal":
      return Crosshair;
    case "TractorBeam":
      return Magnet;
    case "MiningModifier":
      return Pickaxe;
    case "SalvageModifier":
      return Recycle;
    default:
      return Package;
  }
}

// Taille S1–S6 : dérivée du suffixe _sN de output_class (producedItemEntityClass).
// Null pour les objets sans taille (armures FPS).
function extractSizeTag(className: string | null): string | null {
  if (!className) return null;
  const m = /_s(\d)(?:_|$)/i.exec(className) ?? /s(\d)$/i.exec(className);
  return m ? `S${m[1]}` : null;
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

  // ── Familles FR groupées (dérivées de output.type), avec compteurs ──
  const familyData = useMemo(() => {
    const counts = new Map<Family, number>();
    const unmapped = new Set<string>();
    for (const it of items) {
      const fam = familyOf(it.category);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
      // Signale les types vaisseau non répertoriés (rangés par défaut dans Composants).
      if (fam === "Composants vaisseau" && !KNOWN_SHIP_COMPONENT_TYPES.has(it.category)) {
        unmapped.add(it.category);
      }
    }
    const families = FAMILY_ORDER.filter((f) => (counts.get(f) ?? 0) > 0);
    return { counts, families, unmapped };
  }, [items]);

  // Signale en console (une fois) les types non mappés explicitement → famille par défaut.
  useEffect(() => {
    if (familyData.unmapped.size > 0) {
      console.warn(
        "[CraftingHub] types non répertoriés → Composants vaisseau :",
        [...familyData.unmapped],
      );
    }
  }, [familyData]);

  // ── Filtres client ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryFilter !== ALL && familyOf(it.category) !== categoryFilter) return false;
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
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">SC Wiki</p>
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
                  className="h-full rounded-full bg-emerald-500"
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
              {familyData.families.map((fam) => (
                <CategoryChip
                  key={fam}
                  active={categoryFilter === fam}
                  onClick={() => setCategoryFilter(fam)}
                  label={fam}
                  count={familyData.counts.get(fam) ?? 0}
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
      <p className={accent ? "text-xl font-bold text-emerald-300" : "text-xl font-bold text-white"}>
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
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] uppercase tracking-wider transition-colors",
        active
          ? "text-amber-200"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
      style={active ? { borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.15)" } : undefined}
    >
      {label}
      <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-white/70">
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
  const Icon = getBlueprintIcon(item.category);
  const family = familyOf(item.category);
  const sizeTag = extractSizeTag(item.producedItemEntityClass);
  const isFallback = item.displayNameSource === "recordName";
  const preview = item.ingredientPreview.slice(0, 3);
  const hidden = Math.max(0, item.ingredientCount - preview.length);
  const craft = formatCraftTime(item.craftTimeSeconds);

  return (
    <article
      onClick={onClick}
      className={[
        "relative flex cursor-pointer flex-col gap-2.5 rounded-2xl border bg-white/5 p-3.5 transition-colors hover:bg-white/[0.08]",
        owned ? "border-emerald-500/30" : "border-white/10",
      ].join(" ")}
    >
      {/* Possédé (coin haut-droite) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOwned();
        }}
        aria-label={owned ? "Retirer des possédés" : "Marquer comme obtenu"}
        className={[
          "absolute right-2.5 top-2.5 z-[1] flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
          owned
            ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
            : "border-white/15 bg-white/5 text-transparent hover:border-emerald-500/40 hover:text-emerald-300/60",
        ].join(" ")}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      {/* En-tête : icône (gauche) + tags catégorie/taille (droite) */}
      <div className="flex items-start justify-between gap-2 pr-7">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10"
          style={{
            background: "linear-gradient(135deg, rgba(194,119,63,0.20), rgba(255,255,255,0.04))",
            color: "#fbbf24",
          }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1">
          <span
            className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider"
            style={{ borderColor: "rgba(245,158,11,0.25)", color: "#fcd34d" }}
          >
            {family}
          </span>
          {sizeTag && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] tabular-nums" style={{ color: "#fbbf24" }}>
              {sizeTag}
            </span>
          )}
        </div>
      </div>

      {/* Titre (+ « ? » si nom fallback) */}
      <div
        className={["line-clamp-2 font-medium leading-tight text-white", isFallback ? "italic" : ""].join(" ")}
        title={item.displayName}
      >
        {item.displayName}
        {isFallback && <span className="text-white/30"> ?</span>}
      </div>

      {/* Sous-titre : nom produit (si différent du nom affiché) */}
      {item.producedItemName && item.producedItemName !== item.displayName && (
        <div className="truncate text-[11px] text-white/40">{item.producedItemName}</div>
      )}

      {/* Métriques : Craft + Ingrédients */}
      <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-1">
        {craft && (
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">Craft</span>
            <span className="text-[12px] tabular-nums" style={{ color: "#fbbf24" }}>
              {craft}
            </span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">Ingrédients</span>
          <span className="text-[12px] tabular-nums" style={{ color: "#fbbf24" }}>
            {item.ingredientCount}
          </span>
        </div>
      </div>

      {/* Pills : 3 premiers ingrédients + N */}
      {preview.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {preview.map((label, i) => (
            <span
              key={i}
              className="max-w-full truncate rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60"
              title={label}
            >
              {label}
            </span>
          ))}
          {hidden > 0 && (
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] italic text-white/40">
              +{hidden}
            </span>
          )}
        </div>
      )}
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
  // Qualité par slot (0–1000, défaut 500) pilotant les stat cards réactives.
  const [qualities, setQualities] = useState<Record<string, number>>({});
  const getQuality = (k: string) => qualities[k] ?? 500;
  const setSlotQuality = (k: string, v: number) => setQualities((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQualities({}); // réinitialise les sliders au changement de blueprint
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
  const HeaderIcon = getBlueprintIcon(detail?.blueprint.category ?? "");

  // Stats réactives : regroupées par gpp (1 carte) ; slots distincts (1 slider).
  const stats = useMemo(() => (detail?.stats ?? []) as BlueprintStat[], [detail]);
  const statGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BlueprintStat[]>();
    for (const s of stats) {
      if (!map.has(s.gpp)) {
        map.set(s.gpp, []);
        order.push(s.gpp);
      }
      map.get(s.gpp)!.push(s);
    }
    return order.map((gpp) => ({ gpp, label: map.get(gpp)![0]!.statNameLocKey, entries: map.get(gpp)! }));
  }, [stats]);
  const statSlots = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string; label: string }> = [];
    for (const s of stats) {
      const key = s.slotDebugName ?? s.slotName;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ key, label: s.slotName });
      }
    }
    return out;
  }, [stats]);

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
                  <HeaderIcon className="h-7 w-7" />
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

              {/* ── Stat cards — RÉACTIVES si producedItemStatsJson peuplé, sinon MÉTA (fallback) ── */}
              {statGroups.length > 0 ? (
                <section className="border-b border-white/10 px-6 py-4">
                  <div
                    className="grid gap-2.5"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
                  >
                    {statGroups.map((g) => {
                      const c = computeStackedStatValue(g.entries, qualities);
                      const fmt = formatStatDisplay(c);
                      const delta = formatDeltaBadge(c);
                      return (
                        <div
                          key={g.gpp}
                          className="flex flex-col gap-1 rounded-lg border bg-white/5 px-3 py-2.5"
                          style={{ borderColor: "rgba(245,158,11,0.22)" }}
                        >
                          <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                            {g.label}
                          </span>
                          <span className="text-[16px] tabular-nums" style={{ color: "#fbbf24" }}>
                            {fmt.value}
                            {fmt.unit && <span className="ml-1 text-[12px] text-white/40">{fmt.unit}</span>}
                          </span>
                          <span
                            className={[
                              "self-start rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums",
                              delta.sign === "pos"
                                ? "border-emerald-500/40 text-emerald-300"
                                : delta.sign === "neg"
                                  ? "border-red-500/40 text-red-300"
                                  : "border-white/10 text-white/40",
                            ].join(" ")}
                          >
                            {delta.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sliders de qualité par emplacement (0–1000, défaut 500) → recalcul en direct */}
                  <div className="mt-4 flex flex-col gap-2.5">
                    {statSlots.map((s) => (
                      <div key={s.key} className="flex items-center gap-3">
                        <span
                          className="w-40 shrink-0 truncate text-[11px] uppercase tracking-wider"
                          style={{ color: "#c2773f" }}
                        >
                          {s.label}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={1000}
                          step={10}
                          value={getQuality(s.key)}
                          onChange={(e) => setSlotQuality(s.key, Number(e.target.value))}
                          className="h-1 flex-1 accent-amber-400"
                        />
                        <span className="w-24 text-right text-[10px] uppercase tracking-[0.1em] text-white/50">
                          Qualité · {getQuality(s.key)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
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
              )}

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
                            gridTemplateColumns: "minmax(0,1.4fr) 80px 70px",
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
