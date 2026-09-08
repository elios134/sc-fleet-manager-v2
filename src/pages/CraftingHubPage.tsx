import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../lib/uiPersist";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  Atom,
  Backpack,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  // Vignette de l'objet produit (SC Wiki images[0]) — null si absente (repli icône).
  imageUrl?: string | null;
  craftTimeSeconds: number | null;
  ingredientCount: number;
  ingredientPreview: string[];
  // Noms de TOUS les ingrédients (recherche par matériau). Absent sur ancien backend → [].
  ingredientNames?: string[];
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
    imageUrl: string | null;
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
        className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-white/85 transition-colors hover:text-accent"
        style={{
          textDecoration: "underline dotted color-mix(in oklab, var(--accent) 50%, transparent)",
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
            : "border-accent/30 text-accent",
        ].join(" ")}
      >
        {ing.ingredientTypeLabel}
      </span>
      <span className="text-right text-[12px] tabular-nums" style={{ color: "var(--accent)" }}>
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

  // Ingrédient du slot : un seul (les données n'ont pas d'alternatives / selectionGroup,
  // donc chaque groupe ne contient qu'un ingrédient).
  const sel = rep;
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
          <span className="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
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
          className="flex min-w-0 cursor-pointer items-center gap-1 text-left text-[13px] font-semibold text-white/90 transition-colors hover:text-accent"
        >
          <span
            className="truncate"
            style={{
              textDecoration: "underline dotted color-mix(in oklab, var(--accent) 50%, transparent)",
              textUnderlineOffset: "3px",
            }}
          >
            {sel?.ingredientName ?? "—"}
          </span>
          {/* Loupe : signale que le nom est cliquable (→ « où miner »). */}
          <Search className="h-3 w-3 shrink-0 text-white/40" />
        </button>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--accent)" }}>
          {qtyDisplay}
        </span>
      </div>

      {/* Simulateur de qualité : curseur (si plage exploitable) + repères + lignes % */}
      {modifiers.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-2 border-t border-white/10 pt-2.5">
          {showSlider && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">{t('crafting.quality')}</span>
                <span
                  className="rounded-md border px-2 py-0.5 text-[12px] tabular-nums text-accent"
                  style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)", background: "color-mix(in oklab, var(--accent) 8%, transparent)" }}
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
                className="w-full accent-[var(--accent)]"
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
// Mode de recherche : par NOM de blueprint/objet produit, ou par INGRÉDIENT (matériau) de la recette.
type SearchMode = "name" | "ingredient";

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

/* ── Suggestion de blueprint pour un nom de log non apparié (similarité) ── */
// Synonymes FR↔EN (le log FR peut différer du nom EN/FR en base : pièce d'armure,
// type d'arme…). Permet ex. « Torse Aril » → « Aril Core », « Bras » → « arms ».
const MATCH_SYNONYMS: Record<string, string> = {
  bras: "arms",
  brassards: "arms",
  jambes: "legs",
  jambieres: "legs",
  torse: "core",
  plastron: "core",
  casque: "helmet",
  dos: "backpack",
  fusil: "rifle",
  pistolet: "pistol",
  canon: "cannon",
  chargeur: "magazine",
  arbalete: "crossbow",
};
const MATCH_STOPWORDS = new Set(["de", "la", "le", "du", "des", "a", "the", "of"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function matchTokens(s: string): string[] {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !MATCH_STOPWORDS.has(tok))
    .map((tok) => MATCH_SYNONYMS[tok] ?? tok);
}
function tokenHit(a: string, b: string): boolean {
  if (a === b) return true;
  // Préfixe commun ≥ 4 (Bras⊂Brassards, Jamb…) pour tolérer les variantes.
  return Math.min(a.length, b.length) >= 4 && a.slice(0, 4) === b.slice(0, 4);
}
// Meilleur blueprint pour un nom de log : score = part des tokens du log retrouvés
// dans (displayName + producedItemName) du candidat. null sous le seuil de confiance.
function suggestBlueprint(
  logName: string,
  items: CraftingHubBlueprintItem[],
): CraftingHubBlueprintItem | null {
  const lt = matchTokens(logName);
  if (lt.length === 0) return null;
  let best: CraftingHubBlueprintItem | null = null;
  let bestScore = 0;
  let bestGap = Infinity;
  for (const it of items) {
    const ct = [
      ...new Set([...matchTokens(it.displayName), ...matchTokens(it.producedItemName ?? "")]),
    ];
    let matched = 0;
    for (const tok of lt) if (ct.some((c) => tokenHit(c, tok))) matched++;
    const score = matched / lt.length;
    const gap = Math.abs(ct.length - lt.length);
    if (score > bestScore || (score === bestScore && gap < bestGap)) {
      best = it;
      bestScore = score;
      bestGap = gap;
    }
  }
  return bestScore >= 0.5 ? best : null;
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

// Vignette d'un blueprint : image de l'objet produit (API Wiki) avec repli sur l'icône de
// catégorie — si l'image manque OU échoue au chargement (onError). Même source que le
// catalogue (Item.imageUrl). `sizeClass`/`iconClass` calent la tuile sur son contexte
// (11×11 en liste, 14×14 dans l'en-tête de fiche).
function BlueprintThumb({
  imageUrl,
  category,
  name,
  sizeClass,
  iconClass,
  radiusClass = "rounded-lg",
}: {
  imageUrl?: string | null;
  category: string;
  name: string;
  sizeClass: string;
  iconClass: string;
  radiusClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = getBlueprintIcon(category);
  const showImage = !!imageUrl && !failed;
  return (
    <div
      className={`relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden border border-white/10 ${radiusClass}`}
      style={{
        background: showImage
          ? "rgba(0,0,0,0.25)"
          : "linear-gradient(135deg, rgba(194,119,63,0.20), rgba(255,255,255,0.04))",
        color: "var(--accent)",
      }}
    >
      {showImage ? (
        <img
          src={imageUrl!}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Icon className={iconClass} />
      )}
    </div>
  );
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

  // Recherche/filtres/sélection persistants → retrouvés en revenant sur la page (la navigation
  // démonte la page sinon tout est réinitialisé). currentPage reste transitoire (repart à 1).
  const [search, setSearch] = usePersistentState("crafting.search", "");
  const [searchMode, setSearchMode] = usePersistentState<SearchMode>("crafting.searchMode", "name");
  const [ownedFilter, setOwnedFilter] = usePersistentState<OwnedFilter>("crafting.owned", "all");
  // Catégorie ouverte dans la liste : null = on affiche la LISTE DES CATÉGORIES ; sinon, tous
  // les items de cette famille (plus de pagination).
  const [openFamily, setOpenFamily] = usePersistentState<Family | null>("crafting.openFamily", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = usePersistentState<string | null>("crafting.selected", null);
  // Re-cochage depuis Game.log : état + récap affiché.
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  // Noms de log non appariés (mapping manuel) + valeur saisie par ligne.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});

  // Pré-sélection d'un blueprint à l'arrivée (ex. depuis l'onglet Drop du Mission Hub).
  const location = useLocation();
  useEffect(() => {
    const st = location.state as { blueprintId?: string } | null;
    if (st && typeof st.blueprintId === "string") setSelectedId(st.blueprintId);
  }, [location.state]);

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
        setUnmatched([]);
      } else if (r.detected === 0) {
        setResyncMsg(t("crafting.resyncNoneDetected"));
        setUnmatched([]);
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
        // Surface les non-appariés + pré-remplit chaque ligne avec le blueprint le
        // plus probable (similarité) → l'utilisateur n'a qu'à confirmer.
        const names = r.unmatchedNames ?? [];
        setUnmatched(names);
        const prefill: Record<string, string> = {};
        for (const n of names) {
          const bp = suggestBlueprint(n, items);
          if (bp) prefill[n] = bp.displayName;
        }
        setAliasInputs(prefill);
      }
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResyncing(false);
    }
  }

  // Associe un nom de log non apparié au blueprint choisi (persiste + coche).
  async function mapAlias(logName: string) {
    const typed = (aliasInputs[logName] ?? "").trim();
    if (!typed || !accountId) return;
    const bp = items.find((it) => it.displayName === typed);
    if (!bp) {
      setResyncMsg(t("crafting.unmatchedNoBp"));
      return;
    }
    try {
      await invoke("set_blueprint_log_alias", { accountId, logName, blueprintId: bp.id });
      setOwnedIds((prev) => new Set(prev).add(bp.id));
      setUnmatched((prev) => prev.filter((n) => n !== logName));
      setAliasInputs((p) => {
        const next = { ...p };
        delete next[logName];
        return next;
      });
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
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
      if (ownedFilter === "owned" && !ownedIds.has(it.id)) return false;
      if (ownedFilter === "remaining" && ownedIds.has(it.id)) return false;
      if (q.length > 0) {
        // Mode NOM : nom du blueprint/objet produit. Mode INGRÉDIENT : matériau de la recette
        // (« iron » → tous les crafts qui contiennent de l'iron). Toggle Nom/Matériau au-dessus.
        const match =
          searchMode === "ingredient"
            ? (it.ingredientNames ?? []).some((n) => n.toLowerCase().includes(q))
            : `${it.displayName} ${it.producedItemName ?? ""}`.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [items, search, searchMode, ownedFilter, ownedIds]);

  // Recherche active → on court-circuite le drill-down par catégorie et on liste à plat les
  // résultats (toutes familles). Sinon : catégorie ouverte → ses items ; aucune → liste des
  // catégories. Plus de pagination : tout défile.
  const searching = search.trim().length > 0;
  const familyItems = openFamily
    ? filtered.filter((it) => familyOf(it.category) === openFamily)
    : [];

  const total = stats?.total ?? 0;

  return (
    <div className="p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t('crafting.eyebrow')}</p>
          <h1 className="text-2xl font-bold text-white">{t('crafting.title')}</h1>
          <p className="mt-1 max-w-xl text-[13px] text-white/45">{t('crafting.subtitle')}</p>
        </div>
        {/* Re-cochage depuis le jeu (Game.log) — action secondaire, coin haut-droite */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            onClick={() => void handleResync()}
            disabled={resyncing || !accountId}
            title={t('crafting.resyncTitle')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
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
          {/* Non appariés : mapping manuel (mémorisé pour les prochains re-cochages) */}
          {unmatched.length > 0 && (
            <div className="mb-5 rounded-2xl border border-white/10 bg-[#14101f]/70 p-4 backdrop-blur-xl">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-accent">
                <Recycle className="h-4 w-4" />
                {t("crafting.unmatchedTitle", { count: unmatched.length })}
              </div>
              <p className="mb-3 text-xs text-white/45">{t("crafting.unmatchedHint")}</p>
              <datalist id="bp-alias-list">
                {items.map((it) => (
                  <option key={it.id} value={it.displayName} />
                ))}
              </datalist>
              <div className="grid gap-2 sm:grid-cols-2">
                {unmatched.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white" title={name}>
                      {name}
                    </span>
                    <input
                      list="bp-alias-list"
                      value={aliasInputs[name] ?? ""}
                      onChange={(e) =>
                        setAliasInputs((p) => ({ ...p, [name]: e.target.value }))
                      }
                      placeholder={t("crafting.unmatchedPick")}
                      className="w-40 shrink-0 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
                    />
                    <button
                      onClick={() => void mapAlias(name)}
                      disabled={!(aliasInputs[name] ?? "").trim()}
                      className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t("crafting.unmatchedAssign")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filtres */}
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchMode === "ingredient" ? t('crafting.searchByMaterial') : t('crafting.searchPlaceholder')}
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                />
              </div>

              {/* Toggle mode de recherche : par Nom / par Matériau (ingrédient) */}
              <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                {(["name", "ingredient"] as SearchMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSearchMode(m)}
                    className={[
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      searchMode === m ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
                    ].join(" ")}
                  >
                    {m === "name" ? t('crafting.searchModeName') : t('crafting.searchModeMaterial')}
                  </button>
                ))}
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

          </div>

          {/* 2 panneaux : liste (gauche) + fiche (droite). Empilé sur étroit. */}
          <div className="flex flex-col gap-4 lg:h-[calc(100vh-320px)] lg:flex-row">
            {/* ── PANNEAU GAUCHE : liste verticale scrollable ── */}
            <div className="flex flex-col lg:w-[340px] lg:shrink-0 lg:overflow-y-auto">
              {searching ? (
                /* Recherche active → résultats à plat (toutes familles), sans pagination. */
                filtered.length === 0 ? (
                  <p className="text-sm text-white/40">{t('crafting.noMatch')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {filtered.map((it) => (
                      <BlueprintRow
                        key={it.id}
                        item={it}
                        owned={ownedIds.has(it.id)}
                        selected={selectedId === it.id}
                        onClick={() => setSelectedId(it.id)}
                      />
                    ))}
                  </div>
                )
              ) : openFamily ? (
                /* Catégorie ouverte → retour + tous ses items. */
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenFamily(null)}
                    className="mb-1 flex items-center gap-1.5 self-start text-[12px] font-medium text-white/50 transition-colors hover:text-white/90"
                  >
                    <ChevronLeft className="h-4 w-4" /> {t('crafting.allCategories')}
                  </button>
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-white/50">
                      {familyLabel(openFamily, t)}
                    </span>
                    <span className="rounded-full bg-white/10 px-1.5 text-[10.5px] tabular-nums text-white/45">
                      {familyItems.length}
                    </span>
                  </div>
                  {familyItems.length === 0 ? (
                    <p className="text-sm text-white/40">{t('crafting.noMatch')}</p>
                  ) : (
                    familyItems.map((it) => (
                      <BlueprintRow
                        key={it.id}
                        item={it}
                        owned={ownedIds.has(it.id)}
                        selected={selectedId === it.id}
                        onClick={() => setSelectedId(it.id)}
                      />
                    ))
                  )}
                </div>
              ) : (
                /* Par défaut → LISTE DES CATÉGORIES cliquables (Armes FPS, Composants vaisseau…). */
                <div className="flex flex-col gap-1.5">
                  {familyData.families.map((fam) => (
                    <button
                      key={fam}
                      type="button"
                      onClick={() => setOpenFamily(fam)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.07]"
                    >
                      <span className="text-[14px] font-medium text-white">{familyLabel(fam, t)}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/50">
                          {familyData.counts.get(fam) ?? 0}
                        </span>
                        <ChevronRight className="h-4 w-4 text-white/35" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── PANNEAU DROIT : fiche du blueprint sélectionné ── */}
            <div
              className="min-w-0 flex-1 overflow-hidden rounded-2xl border lg:overflow-y-auto"
              style={{ background: "rgba(18,16,22,0.55)", borderColor: "color-mix(in oklab, var(--accent) 20%, transparent)" }}
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


function BlueprintRow({
  item,
  owned,
  selected,
  onClick,
}: {
  item: CraftingHubBlueprintItem;
  owned: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const sizeTag = extractSizeTag(item.producedItemEntityClass);
  const isFallback = item.displayNameSource === "recordName";
  // Sous-titre = type d'objet (classe brute rendue lisible) + taille éventuelle.
  const prettyCat = item.category
    ? item.category.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
    : "";
  const sub = [prettyCat, sizeTag].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-accent/60 bg-accent/10"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]",
      ].join(" ")}
    >
      <BlueprintThumb
        imageUrl={item.imageUrl}
        category={item.category}
        name={item.displayName}
        sizeClass="h-9 w-9"
        iconClass="h-4 w-4"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={["truncate text-[13px] font-medium text-white", isFallback ? "italic" : ""].join(" ")}
          title={item.displayName}
        >
          {item.displayName}
          {isFallback && <span className="text-white/30"> ?</span>}
        </span>
        {sub && <span className="truncate text-[11px] text-white/45">{sub}</span>}
      </span>
      {owned && (
        <span className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
          {t('crafting.owned')}
        </span>
      )}
    </button>
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

// Section repliable (fidèle maquette : « le détail avancé se déplie »).
function Collapsible({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-white/10 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12.5px] font-medium text-white/60 transition-colors hover:text-white/90"
      >
        <span className="flex items-center gap-2">
          {title}
          {count != null && (
            <span className="rounded-full bg-white/10 px-1.5 text-[10.5px] font-normal text-white/45">{count}</span>
          )}
        </span>
        <ChevronDown className={["h-4 w-4 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button>
      {open && <div className="pt-3">{children}</div>}
    </section>
  );
}

// Indicateur de GRADE du composant (C / B / A) — affichage seul, pas un sélecteur.
function GradeIndicator({ grade, label }: { grade: string; label: string }) {
  const g = grade.trim().toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <div className="flex gap-1">
        {["C", "B", "A"].map((x) => (
          <span
            key={x}
            className={[
              "flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold",
              x === g ? "text-white" : "text-white/35",
            ].join(" ")}
            style={x === g ? { background: "var(--accent)" } : { background: "rgba(255,255,255,.06)" }}
          >
            {x}
          </span>
        ))}
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
              {/* En-tête épuré (fidèle maquette) : vignette + titre + sous-titre + Possédé */}
              <header className="border-b border-white/10 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <BlueprintThumb
                      imageUrl={detail.blueprint.imageUrl}
                      category={detail.blueprint.category ?? ""}
                      name={detail.blueprint.displayName}
                      sizeClass="h-70 w-70"
                      iconClass="h-24 w-24"
                      radiusClass="rounded-2xl"
                    />
                    <div className="min-w-0">
                      <h2
                        className="text-[22px] font-semibold leading-tight text-white"
                        style={{
                          fontStyle: detail.blueprint.displayNameSource === "recordName" ? "italic" : "normal",
                        }}
                        title={detail.blueprint.displayName}
                      >
                        {detail.blueprint.displayName}
                        {detail.blueprint.displayNameSource === "recordName" && <span className="text-white/30"> ?</span>}
                      </h2>
                      <p className="mt-1 text-[13px] text-white/55">
                        {[
                          it?.itemType,
                          it?.subType,
                          it?.size != null ? t('crafting.sizeLabel', { size: it.size }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || detail.blueprint.category || "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                        <span className="inline-flex items-center gap-1.5 tabular-nums" style={{ color: "var(--accent)" }}>
                          <Clock className="h-3.5 w-3.5" />
                          {t('crafting.craftLabel', { time: formatCraftTime(detail.blueprint.craftTimeSeconds) })}
                        </span>
                        {detail.blueprint.webUrl && (
                          <button
                            type="button"
                            onClick={() => void openUrl(detail.blueprint.webUrl as string)}
                            className="inline-flex items-center gap-1.5 font-medium text-white/60 transition-colors hover:text-accent"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> {t('crafting.wiki')}
                          </button>
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
                        ? { background: "rgba(16,185,129,0.18)", boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.30)" }
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
              </header>

              {/* Corps épuré (fidèle maquette) : recette simple + stats en barres, avancé replié */}
              <div className="flex flex-col gap-6 px-6 py-5">
                {/* RECETTE — liste simple (nom + ×qté) */}
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    {t('crafting.recipe')}
                    <span className="rounded-full bg-white/10 px-1.5 text-[10.5px] font-normal text-white/45">
                      {detail.ingredients.length}
                    </span>
                  </h3>
                  {detail.ingredients.length === 0 ? (
                    <p className="text-[12px] italic text-white/30">{t('crafting.noIngredient')}</p>
                  ) : (
                    <div className="flex flex-col">
                      {detail.ingredients.map((ing, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 border-t border-white/[0.06] py-2.5 text-[13px] first:border-t-0"
                        >
                          <span className="text-white/85">{ing.ingredientName}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-[var(--accent)]">
                            {ing.quantityLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* STATS DE L'OBJET PRODUIT — barres + indicateur de GRADE (C/B/A) */}
                {statGroups.length > 0 && (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                        {t('crafting.stats')}
                      </h3>
                      {it?.grade && <GradeIndicator grade={it.grade} label={t('crafting.cardGrade')} />}
                    </div>
                    {(() => {
                      const computed = statGroups.map((g) => {
                        const c = computeStackedStatValue(g.entries, qualityBySlot);
                        return { label: g.label, fmt: formatStatDisplay(c), value: c.value };
                      });
                      const max = Math.max(1, ...computed.map((c) => Math.abs(c.value)));
                      return (
                        <div className="flex flex-col gap-2.5">
                          {computed.map((c, i) => (
                            <div
                              key={i}
                              className="grid grid-cols-[minmax(90px,130px)_1fr_auto] items-center gap-3 text-[12.5px]"
                            >
                              <span className="truncate text-white/55">{c.label}</span>
                              <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <span
                                  className="block h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.round((Math.abs(c.value) / max) * 100))}%`,
                                    background: "linear-gradient(90deg, var(--accent), #8b5cf6)",
                                  }}
                                />
                              </span>
                              <span className="text-right tabular-nums text-white/90">
                                {c.fmt.value}
                                {c.fmt.unit && <span className="ml-1 text-white/40">{c.fmt.unit}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </section>
                )}

                {/* Avancé replié : simulateur de qualité par slot + sources d'ingrédients */}
                <Collapsible title={t('crafting.advancedQualitySources')} count={detail.ingredients.length}>
                  {detail.ingredients.length === 0 ? (
                    <p className="text-[12px] italic text-white/30">{t('crafting.noIngredient')}</p>
                  ) : (
                    (() => {
                      const slotGroups = groupIngredientsBySlot(detail.ingredients);
                      if (slotGroups) {
                        return (
                          <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {slotGroups.map((g, gi) => (
                                <SlotBlock
                                  key={`${detail.blueprint.id}-${gi}`}
                                  group={g}
                                  quality={qualityBySlot[g.slotName]}
                                  onQuality={(v) => setQualityBySlot((p) => ({ ...p, [g.slotName]: v }))}
                                  onMine={(ref, name) => setMiningIngredient({ ref, name })}
                                />
                              ))}
                            </div>
                            <p className="mt-3 text-[10px] italic text-white/30">{t('crafting.slidersHint')}</p>
                          </>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-1.5">
                          {detail.ingredients.map((ing, i) => (
                            <IngredientRow key={i} ing={ing} onMine={(ref, name) => setMiningIngredient({ ref, name })} />
                          ))}
                        </div>
                      );
                    })()
                  )}
                </Collapsible>

                {/* Détails repliés : description + Description Data + axes de qualité (si présents) */}
                {(it?.description || (detail.blueprint.descriptionData?.length ?? 0) > 0 || craftAxes.length > 0) && (
                  <Collapsible title={t('crafting.tabDetails')}>
                    <div className="flex flex-col gap-5">
                      {it?.description && (
                        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-white/60">{it.description}</p>
                      )}
                      {detail.blueprint.descriptionData && detail.blueprint.descriptionData.length > 0 && (
                        <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                          {detail.blueprint.descriptionData.map((d, i) => (
                            <DataRow key={`${d.name}-${i}`} label={d.name} value={d.value} />
                          ))}
                        </div>
                      )}
                      {craftAxes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {craftAxes.map((a) => (
                            <span
                              key={a.label}
                              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
                              style={{
                                borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
                                background: "color-mix(in oklab, var(--accent) 8%, transparent)",
                                color: "var(--accent)",
                              }}
                            >
                              {a.label}
                              {a.betterWhen === "higher" && <span aria-label={t('crafting.higherIsBetter')}>↑</span>}
                              {a.betterWhen === "lower" && <span aria-label={t('crafting.lowerIsBetter')}>↓</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Collapsible>
                )}

                {/* Missions de déblocage repliées (si présentes) */}
                {detail.linkedMissions.length > 0 && (
                  <Collapsible title={t('crafting.tabMission')} count={detail.linkedMissions.length}>
                    <div className="flex flex-col gap-4">
                      {linkedSystems.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {linkedSystems.map((s) => (
                            <span
                              key={s}
                              className="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                              style={{
                                borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
                                background: "color-mix(in oklab, var(--accent) 8%, transparent)",
                                color: "var(--accent)",
                              }}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      <ul className="flex flex-col gap-1.5">
                        {detail.linkedMissions.map((m) => {
                          const systems = (m.starSystems ?? "").split(",").map((x) => x.trim()).filter(Boolean);
                          return (
                            <li key={m.missionUuid} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                              <div className="flex items-start justify-between gap-2.5">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] text-white/90">{m.title}</div>
                                  {m.factionName && (
                                    <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">{m.factionName}</div>
                                  )}
                                </div>
                                <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "#c2773f" }}>
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
                  </Collapsible>
                )}
              </div>
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
