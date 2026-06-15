import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  Atom,
  Backpack,
  Check,
  Clock,
  Crosshair,
  ExternalLink,
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
import {
  computeStackedStatValue,
  formatDeltaBadge,
  formatStatDisplay,
  type BlueprintStat,
} from "../lib/craftingStats";
import { computePageNumbers } from "../lib/pagination";

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

// Modifier d'un emplacement (du champ aspects.modifiers du wiki). La valeur du modifier est
// un MULTIPLICATEUR interpolé selon la qualité, entre at_min_quality (à quality_range.min)
// et at_max_quality (à quality_range.max). better_when indique le sens « bon ».
type CraftModifier = {
  label: string | null;
  property_key?: string | null;
  better_when?: string | null; // "higher" | "lower"
  quality_range?: { min: number | null; max: number | null } | null;
  modifier_range?: { at_min_quality: number | null; at_max_quality: number | null } | null;
  value_range_type?: string | null;
};

type BlueprintDetail = {
  blueprint: {
    id: string;
    displayName: string;
    displayNameSource: string;
    producedItemName: string | null;
    category: string | null;
    craftTimeSeconds: number | null;
    webUrl: string | null;
    descriptionData: Array<{ name: string; value: string }> | null;
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
    slotName: string | null;
    slotLabel: string | null;
    requiredCount: number | null;
    selectionGroup: string | null;
    minQuality: number | null;
    sliderMin: number | null;
    sliderMax: number | null;
    initialQuality: number | null;
    modifiers: CraftModifier[] | null;
  }>;
  linkedMissions: Array<{
    missionUuid: string;
    title: string;
    factionName: string | null;
    starSystems: string | null;
    weight: number;
    navigable: boolean;
  }>;
  stats: BlueprintStat[];
};

type CraftIngredient = BlueprintDetail["ingredients"][number];
// slotName = clé BRUTE (ex. « FRAME ») pour la qualité partagée et le match des stats
// (BlueprintStat.slotDebugName ?? slotName). title = libellé affiché (slotLabel sinon slotName).
type SlotGroup = {
  slotName: string;
  title: string;
  requiredCount: number | null;
  items: CraftIngredient[];
};

// Regroupe les ingrédients par EMPLACEMENT (slot). Les ingrédients partageant un même
// selectionGroup (≠ null) sont des ALTERNATIVES d'un seul slot ; sinon, un slot par
// ingrédient. Ordre conservé (champ order). Repli : si aucun slot réel (tout « Recette »
// ou null), renvoie null → le front affiche la liste à plat comme avant.
function groupIngredientsBySlot(ings: CraftIngredient[]): SlotGroup[] | null {
  const hasSlots = ings.some((i) => i.slotName && i.slotName !== "Recette");
  if (!hasSlots) return null;
  const sorted = [...ings].sort((a, b) => a.order - b.order);
  const groups: SlotGroup[] = [];
  const byGroup = new Map<string, SlotGroup>();
  for (const ing of sorted) {
    const slotName = ing.slotName || "Recette";
    const title = ing.slotLabel || ing.slotName || "Recette";
    if (ing.selectionGroup) {
      let g = byGroup.get(ing.selectionGroup);
      if (!g) {
        g = { slotName, title, requiredCount: ing.requiredCount, items: [] };
        byGroup.set(ing.selectionGroup, g);
        groups.push(g);
      }
      g.items.push(ing);
    } else {
      groups.push({ slotName, title, requiredCount: ing.requiredCount, items: [ing] });
    }
  }
  return groups;
}

// Ligne d'un ingrédient : nom cliquable (→ modale « où miner ») + badge type + quantité.
// Réutilisée par l'affichage groupé (par slot) et le repli à plat.
function IngredientRow({
  ing,
  onMine,
}: {
  ing: CraftIngredient;
  onMine: (ref: string, name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
      style={{ gridTemplateColumns: "minmax(0,1.4fr) 70px 64px" }}
    >
      <button
        type="button"
        onClick={() => onMine(ing.ingredientRef, ing.ingredientName)}
        title={t('crafting.seeWhereToMine')}
        className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-white/85 transition-colors hover:text-amber-300"
        style={{
          textDecoration: "underline dotted rgba(245,158,11,0.5)",
          textUnderlineOffset: "3px",
        }}
      >
        <span className="truncate">{ing.ingredientName}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-white/40" />
      </button>
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
      <span className="text-right text-[12px] tabular-nums" style={{ color: "#fbbf24" }}>
        {ing.quantityLabel}
      </span>
    </div>
  );
}

// Multiplicateur d'un modifier à une qualité donnée (interpolation linéaire entre
// at_min_quality @ quality_range.min et at_max_quality @ quality_range.max).
function modifierMultiplier(mod: CraftModifier, quality: number): number {
  const qMin = mod.quality_range?.min ?? 0;
  const qMax = mod.quality_range?.max ?? 1000;
  const aMin = mod.modifier_range?.at_min_quality ?? 1;
  const aMax = mod.modifier_range?.at_max_quality ?? 1;
  if (qMax <= qMin) return aMin;
  const t = Math.min(1, Math.max(0, (quality - qMin) / (qMax - qMin)));
  return aMin + t * (aMax - aMin);
}

function fmtSignedPercent(mult: number): string {
  const pct = Math.round((mult - 1) * 100 * 10) / 10;
  if (pct === 0) return "0 %";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

// Bloc d'un emplacement : titre + ingrédient(s) + simulateur de qualité (curseur + lignes %).
// État de qualité PAR SLOT (indépendant). Le curseur est purement visuel (aucun craft réel).
function SlotBlock({
  group,
  quality,
  onQuality,
  onMine,
}: {
  group: SlotGroup;
  quality: number | undefined; // qualité partagée (parent), undefined → défaut initial
  onQuality: (value: number) => void;
  onMine: (ref: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const rep = group.items[0];
  const sliderMin = rep?.sliderMin ?? 1;
  const sliderMax = rep?.sliderMax ?? 1000;
  // Borne basse = max(sliderMin, minQuality) — on ne descend pas sous minQuality.
  const floor = Math.max(sliderMin, rep?.minQuality ?? sliderMin);
  const initial = Math.min(Math.max(rep?.initialQuality ?? 500, floor), sliderMax);
  const modifiers = rep?.modifiers ?? [];
  const hasRange = sliderMax > floor;
  const showSlider = modifiers.length > 0 && hasRange;

  // Qualité courante = valeur partagée (parent) sinon l'initiale du slot.
  const current = quality ?? initial;
  const effectiveQuality = showSlider ? current : initial;

  // Ingrédient sélectionné (parmi les alternatives du slot).
  const [selIdx, setSelIdx] = useState(0);
  const sel = group.items[Math.min(selIdx, group.items.length - 1)] ?? rep;
  // Quantité : « 0.36 SCU » pour une ressource ; « 7 items » pour un objet (reformaté
  // depuis « ×7 », le nombre brut n'étant pas exposé au front).
  const qtyRaw = sel?.quantityLabel ?? "";
  const qtyDisplay =
    sel && sel.ingredientType !== "resource" && qtyRaw.startsWith("×")
      ? t('crafting.itemsCount', { count: Number(qtyRaw.slice(1)) || 0 })
      : qtyRaw;

  function modifierColor(mod: CraftModifier, mult: number): string {
    const delta = mult - 1;
    if (Math.abs(delta) < 0.0005) return "rgba(255,255,255,0.55)";
    const improves =
      (mod.better_when === "higher" && delta > 0) || (mod.better_when === "lower" && delta < 0);
    if (mod.better_when !== "higher" && mod.better_when !== "lower")
      return "rgba(255,255,255,0.75)";
    return improves ? "#34d399" : "#f87171";
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3.5">
      {/* Surtitre du slot (gris/cuivre, majuscules) + ×N */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "#c2773f" }}
        >
          {group.title}
        </span>
        {group.requiredCount != null && group.requiredCount > 1 && (
          <span className="rounded-full border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            ×{group.requiredCount}
          </span>
        )}
      </div>

      {/* Ligne : nom ingrédient (gras, cliquable → où miner) + quantité à droite */}
      <div className="flex items-baseline justify-between gap-2.5">
        <button
          type="button"
          onClick={() => sel && onMine(sel.ingredientRef, sel.ingredientName)}
          title={t('crafting.seeWhereToMine')}
          className="min-w-0 truncate text-left text-[13px] font-semibold text-white/90 transition-colors hover:text-amber-300"
          style={{
            textDecoration: "underline dotted rgba(245,158,11,0.5)",
            textUnderlineOffset: "3px",
          }}
        >
          {sel?.ingredientName ?? "—"}
        </button>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "#fbbf24" }}>
          {qtyDisplay}
        </span>
      </div>

      {/* Select d'ingrédient pleine largeur (alternatives du slot ; 1 option sinon) */}
      <select
        value={selIdx}
        onChange={(e) => setSelIdx(parseInt(e.target.value, 10))}
        disabled={group.items.length <= 1}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/85 focus:border-amber-400/40 focus:outline-none disabled:opacity-70"
      >
        {group.items.map((ing, i) => (
          <option key={i} value={i} style={{ background: "#16121c" }}>
            {ing.ingredientName}
          </option>
        ))}
      </select>

      {/* Simulateur de qualité : curseur (si plage exploitable) + repères + lignes % */}
      {modifiers.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-2 border-t border-white/10 pt-2.5">
          {showSlider && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">{t('crafting.quality')}</span>
                <span
                  className="rounded-md border px-2 py-0.5 text-[12px] tabular-nums text-amber-300"
                  style={{ borderColor: "rgba(245,158,11,0.30)", background: "rgba(245,158,11,0.08)" }}
                >
                  {Math.round(current)}
                </span>
              </div>
              <input
                type="range"
                min={floor}
                max={sliderMax}
                step={1}
                value={current}
                onChange={(e) => onQuality(parseInt(e.target.value, 10))}
                className="w-full accent-amber-400"
                aria-label={t('crafting.qualityAria', { slot: group.title })}
              />
              {/* Repères : min (gauche) · Base N (centre) · max (droite) */}
              <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-white/30">
                <span>{floor}</span>
                <span>{t('crafting.base', { value: initial })}</span>
                <span>{sliderMax}</span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {modifiers.map((mod, i) => {
              const mult = modifierMultiplier(mod, effectiveQuality);
              return (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/55">{mod.label ?? "—"}</span>
                  <span className="tabular-nums font-medium" style={{ color: modifierColor(mod, mult) }}>
                    {fmtSignedPercent(mult)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

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

// Libellé traduit d'une famille (la valeur FR interne sert de clé d'état/filtre).
const FAMILY_KEY: Record<Family, string> = {
  "Armures FPS": "crafting.family.fpsArmours",
  "Armes FPS": "crafting.family.fpsWeapons",
  "Composants vaisseau": "crafting.family.shipComponents",
  "Armes vaisseau": "crafting.family.shipWeapons",
  "Objets mission": "crafting.family.missionItems",
  Autres: "crafting.family.other",
};
function familyLabel(fam: Family, t: TFunction): string {
  return t(FAMILY_KEY[fam]);
}

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
  const { t } = useTranslation();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Re-cochage depuis Game.log : état + récap affiché.
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);

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

  // Re-coche les blueprints débloqués en jeu (lecture Game.log), puis recharge les possédés.
  type ResyncRecap = {
    logFound: boolean;
    detected: number;
    alreadyOwned: number;
    newlyChecked: number;
    ambiguousSkipped: number;
    unmatched: number;
    unmatchedNames: string[];
  };
  async function handleResync() {
    if (resyncing || !accountId) return;
    setResyncing(true);
    setResyncMsg(null);
    try {
      const r = await invoke<ResyncRecap>("resync_blueprints_from_log", { accountId });
      if (!r.logFound) {
        setResyncMsg(t("crafting.resyncLogNotFound"));
      } else if (r.detected === 0) {
        setResyncMsg(t("crafting.resyncNoneDetected"));
      } else {
        // Recharge les possédés (la map a pu changer).
        const owned = await invoke<string[]>("list_blueprint_owned", { accountId });
        setOwnedIds(new Set(owned));
        const extra =
          r.unmatched > 0 ? t("crafting.resyncUnmatched", { count: r.unmatched }) : "";
        setResyncMsg(
          t("crafting.resyncDetected", {
            detected: r.detected,
            newlyChecked: r.newlyChecked,
            alreadyOwned: r.alreadyOwned,
            extra,
          }),
        );
        if (r.unmatched > 0) console.warn("[crafting] non appariés (FR):", r.unmatchedNames);
      }
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResyncing(false);
    }
  }

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
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t('crafting.eyebrow')}</p>
        <h1 className="text-2xl font-bold text-white">{t('crafting.title')}</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('crafting.loadingCatalogue')}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t('crafting.errorPrefix', { message: error })}
        </p>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">
            {t('crafting.catalogueEmpty')}
          </p>
          <Link
            to="/settings"
            className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('crafting.goToSettings')}
          </Link>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mb-6 flex flex-wrap items-center gap-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
            <Stat label={t('crafting.statBlueprints')} value={String(total)} />
            <Stat label={t('crafting.statOwned')} value={String(ownedCount)} accent />
            <Stat label={t('crafting.statRemaining')} value={String(total - ownedCount)} />
            <div className="min-w-[160px] flex-1">
              <div className="mb-1 flex justify-between text-xs text-white/40">
                <span>{t('crafting.progression')}</span>
                <span>{ownedProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${ownedProgress}%` }}
                />
              </div>
            </div>

            {/* Re-cochage depuis le jeu (Game.log) */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                onClick={() => void handleResync()}
                disabled={resyncing || !accountId}
                title={t('crafting.resyncTitle')}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resyncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('crafting.readingGame')}
                  </>
                ) : (
                  <>
                    <Recycle className="h-4 w-4" /> {t('crafting.resyncFromGame')}
                  </>
                )}
              </button>
              {resyncMsg && <span className="text-[11px] text-white/50">{resyncMsg}</span>}
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
                  placeholder={t('crafting.searchPlaceholder')}
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
                    {f === "all"
                      ? t('crafting.filterAll')
                      : f === "owned"
                        ? t('crafting.filterOwned')
                        : t('crafting.filterRemaining')}
                  </button>
                ))}
              </div>
            </div>

            {/* Chips catégories */}
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip
                active={categoryFilter === ALL}
                onClick={() => setCategoryFilter(ALL)}
                label={t('crafting.categoryAll')}
                count={total}
              />
              {familyData.families.map((fam) => (
                <CategoryChip
                  key={fam}
                  active={categoryFilter === fam}
                  onClick={() => setCategoryFilter(fam)}
                  label={familyLabel(fam, t)}
                  count={familyData.counts.get(fam) ?? 0}
                />
              ))}
            </div>
          </div>

          {/* 2 panneaux : liste (gauche) + fiche (droite). Empilé sur étroit. */}
          <div className="flex flex-col gap-4 lg:h-[calc(100vh-320px)] lg:flex-row">
            {/* ── PANNEAU GAUCHE : liste verticale scrollable ── */}
            <div className="flex flex-col lg:w-[340px] lg:shrink-0 lg:overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-white/40">{t('crafting.noMatch')}</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {pageItems.map((it) => (
                    <BlueprintCard
                      key={it.id}
                      item={it}
                      owned={ownedIds.has(it.id)}
                      selected={selectedId === it.id}
                      onToggleOwned={() => toggleOwned(it.id)}
                      onClick={() => setSelectedId(it.id)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination (bas du panneau gauche) */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-1">
                  <PageBtn disabled={safePage === 1} onClick={() => setCurrentPage(safePage - 1)}>
                    ‹
                  </PageBtn>
                  {computePageNumbers(safePage, totalPages).map((p, i) =>
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
            </div>

            {/* ── PANNEAU DROIT : fiche du blueprint sélectionné ── */}
            <div
              className="min-w-0 flex-1 overflow-hidden rounded-2xl border lg:overflow-y-auto"
              style={{ background: "rgba(18,16,22,0.55)", borderColor: "rgba(245,158,11,0.20)" }}
            >
              {selectedId ? (
                <BlueprintDetailPanel
                  key={selectedId}
                  blueprintId={selectedId}
                  accountId={accountId}
                  isOwned={ownedIds.has(selectedId)}
                  onToggleOwned={() => toggleOwned(selectedId)}
                />
              ) : (
                <div className="flex h-full min-h-[300px] items-center justify-center p-10 text-center text-sm text-white/40">
                  {t('crafting.selectPrompt')}
                </div>
              )}
            </div>
          </div>
        </>
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
  selected,
  onToggleOwned,
  onClick,
}: {
  item: CraftingHubBlueprintItem;
  owned: boolean;
  selected?: boolean;
  onToggleOwned: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
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
        "relative flex cursor-pointer flex-col gap-2.5 rounded-2xl border p-3.5 transition-colors",
        selected
          ? "border-amber-400/60 bg-amber-400/10"
          : owned
            ? "border-emerald-500/30 bg-white/5 hover:bg-white/[0.08]"
            : "border-white/10 bg-white/5 hover:bg-white/[0.08]",
      ].join(" ")}
    >
      {/* Possédé (coin haut-droite) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOwned();
        }}
        aria-label={owned ? t('crafting.removeFromOwned') : t('crafting.markAsObtained')}
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
            {familyLabel(family, t)}
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
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">{t('crafting.cardCraft')}</span>
            <span className="text-[12px] tabular-nums" style={{ color: "#fbbf24" }}>
              {craft}
            </span>
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-[0.14em] text-white/40">{t('crafting.cardIngredients')}</span>
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

// Ligne « label → valeur » de l'onglet Détails (Description Data). « — » si absente.
function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-[12px]">
      <span className="text-white/40">{label}</span>
      <span className="text-right text-white/85">{value && value !== "" ? value : "—"}</span>
    </div>
  );
}

// Carte d'info d'en-tête (Grade / Size / Class / Manufacturer) — label discret + valeur,
// « — » si absente (jamais de carte vide cassée).
function HeaderInfoCard({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</span>
      <span
        className="truncate text-[13px] font-medium text-white/90"
        title={value && value !== "" ? value : "—"}
      >
        {value && value !== "" ? value : "—"}
      </span>
    </div>
  );
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
// Clés i18n des méthodes/raretés (valeurs d'enum issues des données → libellés UI traduits).
const METHOD_KEY: Record<string, string> = {
  fps: "crafting.method.fps",
  ground_vehicle: "crafting.method.vehicle",
  ship: "crafting.method.ship",
};
const RARITY_KEY: Record<string, string> = {
  common: "crafting.rarity.common",
  uncommon: "crafting.rarity.uncommon",
  rare: "crafting.rarity.rare",
  epic: "crafting.rarity.epic",
  legendary: "crafting.rarity.legendary",
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

function BlueprintDetailPanel({
  blueprintId,
  accountId,
  isOwned,
  onToggleOwned,
}: {
  blueprintId: string;
  accountId: string;
  isOwned: boolean;
  onToggleOwned: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Onglet actif de la fiche (Détails / Craft / Mission).
  const [tab, setTab] = useState<"details" | "craft" | "mission">("craft");
  // Ingrédient dont on affiche les localisations de minage (modale « où miner »).
  const [miningIngredient, setMiningIngredient] = useState<{ ref: string; name: string } | null>(
    null,
  );
  // Qualité PARTAGÉE par slot (clé = slotName brut, ex. « FRAME »). Vide → défaut 500/initial.
  // Pilote les curseurs des cartes ET le recalcul live des stats agrégées (computeStackedStatValue).
  const [qualityBySlot, setQualityBySlot] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQualityBySlot({}); // réinitialise au changement de blueprint
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

  // Axes de qualité (onglet Détails) : labels distincts des modifiers de tous les slots
  // (les MÊMES que le simulateur Craft) + labels de stats lisibles (hors clés LOC « @… »).
  const craftAxes = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; betterWhen: string | null }> = [];
    const add = (l: string | null | undefined, betterWhen: string | null) => {
      const v = l?.trim();
      if (v && !v.startsWith("@") && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        out.push({ label: v, betterWhen });
      }
    };
    for (const ing of detail?.ingredients ?? []) {
      for (const m of ing.modifiers ?? []) add(m.label, m.better_when ?? null);
    }
    for (const g of statGroups) add(g.label, null); // stats sans sens « bon » connu
    return out;
  }, [detail, statGroups]);

  // Systèmes agrégés des missions liées (starSystems = chaîne « Nyx, Pyro, Stanton »).
  const linkedSystems = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of detail?.linkedMissions ?? []) {
      for (const s of (m.starSystems ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
    }
    return out;
  }, [detail]);

  // Panneau fiche, rendu INLINE dans la colonne droite (plus de modale overlay).
  const bpPanel = (
    <div className="relative w-full text-[13px] text-white/90">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-8 py-20 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('crafting.loadingShort')}
            </div>
          ) : error || !detail ? (
            <div className="px-8 py-20 text-center text-sm text-red-300">
              {error ?? t('crafting.blueprintNotFound')}
            </div>
          ) : (
            <>
              {/* ── En-tête (style store RSI/Multitool, DA V2) ── */}
              <header
                className="border-b border-white/10 px-6 py-5"
                style={{
                  background:
                    "radial-gradient(ellipse at top right, rgba(245,158,11,0.10), transparent 70%)",
                }}
              >
                {/* Ligne 1 : icône + (surtitre catégorie · nom · code) — Possédé à droite */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(194,119,63,0.30), rgba(255,255,255,0.04))",
                        color: "#fbbf24",
                      }}
                    >
                      <HeaderIcon className="h-7 w-7" />
                    </div>

                    <div className="min-w-0">
                      {/* Surtitre catégorie : itemType · subType (repli sur category) */}
                      <div
                        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: "#c2773f" }}
                      >
                        {[it?.itemType, it?.subType].filter(Boolean).join(" · ") ||
                          detail.blueprint.category ||
                          "—"}
                      </div>

                      <h2
                        className="mt-0.5 text-[22px] font-semibold leading-tight text-white"
                        style={{
                          fontStyle:
                            detail.blueprint.displayNameSource === "recordName"
                              ? "italic"
                              : "normal",
                        }}
                        title={detail.blueprint.displayName}
                      >
                        {detail.blueprint.displayName}
                        {detail.blueprint.displayNameSource === "recordName" && (
                          <span className="text-white/30"> ?</span>
                        )}
                      </h2>

                      {/* Code interne (entity class), discret sous le nom */}
                      {it?.className && (
                        <div className="mt-0.5 font-mono text-[11px] text-white/35">
                          {it.className}
                        </div>
                      )}

                      {/* Badges : grade / size / fabricant */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {it?.grade && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                            {t('crafting.gradeLabel', { grade: it.grade })}
                          </span>
                        )}
                        {it?.size != null && (
                          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            {t('crafting.sizeLabel', { size: it.size })}
                          </span>
                        )}
                        {it?.manufacturer && (
                          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                            {it.manufacturer}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bouton Possédé (haut droite) */}
                  <button
                    onClick={onToggleOwned}
                    className={[
                      "inline-flex shrink-0 items-center gap-2 self-start rounded-lg border px-4 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors",
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
                        <Check className="h-3.5 w-3.5" /> {t('crafting.owned')}
                      </>
                    ) : (
                      t('crafting.markAsObtained')
                    )}
                  </button>
                </div>

                {/* Rangée de 4 cartes : Grade / Size / Class / Manufacturer */}
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <HeaderInfoCard label={t('crafting.cardGrade')} value={it?.grade} />
                  <HeaderInfoCard label={t('crafting.cardSize')} value={it?.size != null ? `S${it.size}` : null} />
                  <HeaderInfoCard label={t('crafting.cardClass')} value={it?.className} />
                  <HeaderInfoCard label={t('crafting.cardManufacturer')} value={it?.manufacturer} />
                </div>

                {/* Ligne « Craft <temps> » + bouton Wiki (si webUrl) */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-1.5 text-[12px] tabular-nums"
                    style={{ color: "#fbbf24" }}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {t('crafting.craftLabel', { time: formatCraftTime(detail.blueprint.craftTimeSeconds) })}
                  </span>
                  {detail.blueprint.webUrl && (
                    <button
                      type="button"
                      onClick={() => void openUrl(detail.blueprint.webUrl as string)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:border-amber-400/40 hover:text-amber-300"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('crafting.wiki')}
                    </button>
                  )}
                </div>

                {/* Description (déplacée vers l'onglet Détails au Lot R3) */}
                {it?.description && (
                  <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-white/55">
                    {it.description}
                  </p>
                )}
              </header>

              {/* ── Onglets : Détails / Craft / Mission ── */}
              <div className="flex items-center gap-1 border-b border-white/10 px-6 pt-3">
                {(
                  [
                    ["details", t('crafting.tabDetails')],
                    ["craft", t('crafting.tabCraft')],
                    ["mission", t('crafting.tabMission')],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={[
                      "relative px-4 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors",
                      tab === key ? "text-amber-300" : "text-white/45 hover:text-white/80",
                    ].join(" ")}
                  >
                    {label}
                    {tab === key && (
                      <span
                        className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                        style={{ background: "#fbbf24" }}
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* ── Onglet DÉTAILS : Description Data + Axes craft ── */}
              {tab === "details" && (
                <div className="flex flex-col gap-5 px-6 py-5">
                  {it?.description && (
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-white/60">
                      {it.description}
                    </p>
                  )}

                  <section>
                    <h3
                      className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--amber)" }}
                    >
                      {t('crafting.descriptionData')}
                    </h3>
                    {detail.blueprint.descriptionData && detail.blueprint.descriptionData.length > 0 ? (
                      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                        {detail.blueprint.descriptionData.map((d, i) => (
                          <DataRow key={`${d.name}-${i}`} label={d.name} value={d.value} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] italic text-white/30">{t('crafting.noDescriptiveData')}</p>
                    )}
                  </section>

                  <section>
                    <h3
                      className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--amber)" }}
                    >
                      {t('crafting.craftAxes')}
                      {craftAxes.length > 0 && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tracking-normal text-white/40">
                          {craftAxes.length}
                        </span>
                      )}
                    </h3>
                    {craftAxes.length === 0 ? (
                      <p className="text-[12px] italic text-white/30">{t('crafting.noQualityAxis')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {craftAxes.map((a) => (
                          <span
                            key={a.label}
                            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
                            style={{
                              borderColor: "rgba(245,158,11,0.30)",
                              background: "rgba(245,158,11,0.08)",
                              color: "#fbbf24",
                            }}
                          >
                            {a.label}
                            {a.betterWhen === "higher" && <span aria-label={t('crafting.higherIsBetter')}>↑</span>}
                            {a.betterWhen === "lower" && <span aria-label={t('crafting.lowerIsBetter')}>↓</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* ── Onglet CRAFT : stats recalculées en direct (bloc haut) ── */}
              {tab === "craft" && statGroups.length > 0 && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h3
                    className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: "var(--amber)" }}
                  >
                    {t('crafting.stats')}
                  </h3>
                  <div
                    className="grid gap-2.5"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
                  >
                    {statGroups.map((g) => {
                      const c = computeStackedStatValue(g.entries, qualityBySlot);
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
                            {fmt.unit && (
                              <span className="ml-1 text-[12px] text-white/40">{fmt.unit}</span>
                            )}
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
                </section>
              )}

              {/* ── Onglet CRAFT : une carte par emplacement (tout regroupé) ── */}
              {tab === "craft" && (
              <section className="border-b border-white/10 px-6 py-4">
                <h3
                  className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--amber)" }}
                >
                  {t('crafting.recipe')}
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tracking-normal text-white/40">
                    {detail.ingredients.length}
                  </span>
                </h3>
                {detail.ingredients.length === 0 ? (
                  <p className="text-[12px] italic text-white/30">{t('crafting.noIngredient')}</p>
                ) : (
                  (() => {
                    const slotGroups = groupIngredientsBySlot(detail.ingredients);
                    // Affichage GROUPÉ PAR EMPLACEMENT : grille de blocs (multi-colonnes sur
                    // large, 1 colonne sur étroit), DA V2 (ambre/doré, fonds sombres).
                    if (slotGroups) {
                      return (
                        <>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {slotGroups.map((g, gi) => (
                              <SlotBlock
                                key={`${detail.blueprint.id}-${gi}`}
                                group={g}
                                quality={qualityBySlot[g.slotName]}
                                onQuality={(v) =>
                                  setQualityBySlot((p) => ({ ...p, [g.slotName]: v }))
                                }
                                onMine={(ref, name) => setMiningIngredient({ ref, name })}
                              />
                            ))}
                          </div>
                          <p className="mt-3 text-[10px] italic text-white/30">
                            {t('crafting.slidersHint')}
                          </p>
                        </>
                      );
                    }
                    // Repli : pas d'emplacements réels → liste à plat (comportement d'avant).
                    return (
                      <div className="grid gap-3.5" style={{ gridTemplateColumns: "140px 1fr" }}>
                        <div
                          className="pt-2 text-[11px] uppercase tracking-[0.1em]"
                          style={{ color: "#c2773f" }}
                        >
                          {t('crafting.recipe')}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {detail.ingredients.map((ing, i) => (
                            <IngredientRow
                              key={i}
                              ing={ing}
                              onMine={(ref, name) => setMiningIngredient({ ref, name })}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })()
                )}
              </section>
              )}

              {/* Onglet MISSION (placeholder — Lot R4) */}
              {/* ── Onglet MISSION : systèmes agrégés + liste des missions de déblocage ── */}
              {tab === "mission" &&
                (detail.linkedMissions.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-white/40">
                    {t('crafting.noUnlockMission')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 px-6 py-5">
                    {/* Pastilles de systèmes (agrégat dédupliqué) */}
                    {linkedSystems.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {linkedSystems.map((s) => (
                          <span
                            key={s}
                            className="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                            style={{
                              borderColor: "rgba(245,158,11,0.30)",
                              background: "rgba(245,158,11,0.08)",
                              color: "#fbbf24",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Liste des missions liées */}
                    <ul className="flex flex-col gap-1.5">
                      {detail.linkedMissions.map((m) => {
                        const systems = (m.starSystems ?? "")
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                        return (
                          <li
                            key={m.missionUuid}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] text-white/90">{m.title}</div>
                                {m.factionName && (
                                  <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
                                    {m.factionName}
                                  </div>
                                )}
                              </div>
                              <span
                                className="shrink-0 text-[12px] tabular-nums"
                                style={{ color: "#c2773f" }}
                              >
                                {Math.round(m.weight * 100)} %
                              </span>
                            </div>
                            {systems.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {systems.map((s) => (
                                  <span
                                    key={s}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </>
          )}
        </div>
  );

  return (
    <>
      {bpPanel}
      {/* Modale « où miner » (overlay), ouverte depuis un ingrédient du Craft. */}
      {miningIngredient && (
        <IngredientMiningModal
          ingredientRef={miningIngredient.ref}
          ingredientName={miningIngredient.name}
          panelMode={false}
          onClose={() => setMiningIngredient(null)}
        />
      )}
    </>
  );
}

// (L'intégration de la modale Mission Intel reviendra au Lot R4, dans l'onglet « Mission ».)
