import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Search, Rotate3d, Box, Footprints } from "lucide-react";
import { usePersistentState } from "../lib/uiPersist";
import Dropdown from "../components/ui/Dropdown";
import {
  fetchShip3DIndex,
  indexShipsByName,
  normalizeShipKey,
  ship3dModelUrl,
  sortedVariants,
  type Ship3DShip,
  type Ship3DVariant,
} from "../lib/ship3d";
import { parseShipLights, type ShipLightDef } from "../lib/ship3dLights";

/* Onglet « Vaisseaux 3D » : liste + viewer three.js (lazy). Chaque vaisseau expose jusqu'à
   3 niveaux (Aperçu / Détaillé / Intérieur) via la mini-API asset-3d. Aperçu chargé par
   défaut ; les niveaux plus lourds au clic (téléchargement Rust + cache disque sha256).
   Pas de modèle → fallback image ShipData. */

const ShipViewer3D = lazy(() => import("../components/ship3d/ShipViewer3D"));
const ShipWalk = lazy(() => import("../components/ship3d/ShipWalk"));

interface ShipRow {
  id: number;
  name: string;
  manufacturer: string;
  classification: string;
  length: number | null;
  beam: number | null;
  height: number | null;
  crewMax: number | null;
  imageUrl: string | null;
}

function fmtMB(bytes?: number): string {
  if (!bytes) return "—";
  return `${Math.round(bytes / 1e6)} Mo`;
}
function fmtTris(n?: number): string {
  if (!n) return "—";
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`;
}

// Télécharge (via Rust + cache sha256) la variante choisie → blob local prêt pour three.js.
function useShipModel(variant: Ship3DVariant | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!variant) {
      setBlobUrl(null);
      setLoading(false);
      return;
    }
    let obj: string | null = null;
    let cancelled = false;
    setBlobUrl(null);
    setLoading(true);
    invoke<ArrayBuffer>("get_ship_model", { url: ship3dModelUrl(variant), sha256: variant.sha256 ?? null })
      .then((buf) => {
        if (cancelled) return;
        obj = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
        setBlobUrl(obj);
        if (variant.sha256) setLoaded((p) => (p.has(variant.sha256!) ? p : new Set(p).add(variant.sha256!)));
      })
      .catch(() => {
        /* échec réseau → on reste sur le blockout */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.modelUrl, variant?.sha256]);
  return { blobUrl, loading, loaded };
}

// Sidecar lumières de la variante Visite (si publié dans l'index) : même canal que les .glb
// (téléchargement Rust anti-CORS + cache disque sha256). null tant que non chargé / absent —
// la Visite marche sans (éclairage générique seul), les lumières s'ajoutent quand elles arrivent.
function useShipLights(variant: Ship3DVariant | null) {
  const [lights, setLights] = useState<ShipLightDef[] | null>(null);
  useEffect(() => {
    const ref = variant?.lights;
    if (!ref?.url) {
      setLights(null);
      return;
    }
    let cancelled = false;
    setLights(null);
    invoke<ArrayBuffer>("get_ship_model", { url: ship3dModelUrl({ modelUrl: ref.url }), sha256: ref.sha256 ?? null })
      .then((buf) => {
        if (cancelled) return;
        const parsed = parseShipLights(buf);
        setLights(parsed.length > 0 ? parsed : null);
      })
      .catch(() => {
        /* échec réseau → Visite sans lumières embarquées */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.lights?.url, variant?.lights?.sha256]);
  return lights;
}

// Intérieurs VIDES ou INEXPLOITABLES : StarBreaker n'exporte pas les « object containers », donc sur
// certains vaisseaux l'intérieur est une coquille vide (aucune pièce/cloison/objet) ou trop dégradé
// (éléments mal placés, quasi rien) → la Visite n'a aucun intérêt. On les exclut. Exclusion par nom,
// provisoire, en attendant un flag asset-3d (ex. interiorWalkableM2 ≈ 0 ou interiorKind:"empty").
// Mauler Destroyer = vide confirmé (LOD1 = 0 objet nouveau). Ironclad / Ironclad Assault = intérieur
// cassé au test round 8 (très peu de détails, éléments mal placés) → retirés en attendant un fix asset.
// Mauler Destroyer : intérieur explosé (géométrie non exportée) → exclu de l'index par asset-3d
// (variante exterior seule). Le gate reste par sécurité (aucune variante interior → déjà non visitable).
const EMPTY_INTERIOR = new Set(["Mauler Destroyer", "Ironclad", "Ironclad Assault"]);

export default function Ship3DPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [models, setModels] = useState<Map<string, Ship3DShip>>(new Map());
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePersistentState("ship3d.search", "");
  const [manuFilter, setManuFilter] = usePersistentState("ship3d.manu", "all");
  const [visitableOnly, setVisitableOnly] = usePersistentState("ship3d.visitableOnly", false);
  const [selName, setSelName] = usePersistentState<string | null>("ship3d.selected", null);
  const [visite, setVisite] = useState(false); // mode Visite 1re personne (collision)

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingList(true);
      setError(null);
      try {
        const [data, idx] = await Promise.all([invoke<ShipRow[]>("get_all_ship_data"), fetchShip3DIndex()]);
        if (cancelled) return;
        setShips(data);
        setModels(indexShipsByName(idx));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Variantes purement cosmétiques (peintures/éditions) exclues du tab 3D : elles n'ont pas
  // de modèle distinct. Alignées sur les exclusions côté asset-3d.
  const EXCLUDED_VARIANTS = /wikelo|pyam|best in show|exec/i;

  // Vaisseaux dédupliqués (hors variantes) — base des filtres et de la liste des constructeurs.
  const dedup = useMemo(() => {
    const seen = new Set<string>();
    return ships.filter((s) =>
      EXCLUDED_VARIANTS.test(s.name) ? false : seen.has(s.name) ? false : (seen.add(s.name), true),
    );
  }, [ships]);

  // Constructeurs présents (triés), pour le filtre.
  const manufacturers = useMemo(
    () => Array.from(new Set(dedup.map((s) => s.manufacturer).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dedup],
  );

  // Vaisseau « visitable » = a un intérieur HABITABLE publié (vraies pièces : lit/rack/soute), pas un
  // cockpit pur. On se fie au flag `interiorKind` d'asset-3d (mesuré au build : `habitable` = ≥ 100 m²
  // de plancher praticable, `cockpit` = habitacle nu) plutôt qu'à l'équipage : beaucoup de mono-place
  // (Cutter, Vulture, Terrapin, Avenger…) ont un vrai habitacle et méritent la Visite. `crewMax` ne
  // gate donc plus (il excluait à tort ces mono-place). flag absent (ancien index) = traité habitable.
  const isVisitable = (s: ShipRow) => {
    if (EMPTY_INTERIOR.has(s.name)) return false; // intérieur vide (object containers non exportés)
    const interior = models.get(normalizeShipKey(s.name))?.variants.find((v) => v.level === "interior");
    return !!interior && interior.interiorKind !== "cockpit";
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visitableCount = useMemo(() => dedup.filter(isVisitable).length, [dedup, models]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dedup
      .filter((s) => !visitableOnly || isVisitable(s))
      .filter((s) => manuFilter === "all" || s.manufacturer === manuFilter)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedup, search, manuFilter, visitableOnly, models]);

  const selected = useMemo(() => ships.find((s) => s.name === selName) ?? null, [ships, selName]);
  const model = selected ? models.get(normalizeShipKey(selected.name)) : undefined;
  const variants = model ? sortedVariants(model) : [];
  // Vue par défaut = Aperçu EXTÉRIEUR pour tous (propre/optimisé). Les intérieurs (Phase 1) sont
  // en placement best-effort → trop rough pour la vitrine ; on les réserve à la Visite 1re
  // personne, proposée pour tout vaisseau ayant un intérieur.
  const exteriorVariant = variants.find((v) => v.level === "exterior") ?? null;
  const interiorVariant = variants.find((v) => v.level === "interior") ?? null;
  const mainVariant = exteriorVariant ?? interiorVariant ?? null;
  const walkVariant = interiorVariant; // intérieur pour la Visite
  const activeVariant = visite && walkVariant ? walkVariant : mainVariant;
  const dims =
    selected && selected.length != null && selected.beam != null && selected.height != null
      ? { l: selected.length, b: selected.beam, h: selected.height }
      : model?.dims ?? null;
  const hasModel = (s: ShipRow) => models.has(normalizeShipKey(s.name));

  const { blobUrl, loading } = useShipModel(activeVariant);
  // Lumières embarquées : chargées seulement en Visite (le viewer extérieur n'en a pas besoin).
  const walkLights = useShipLights(visite ? walkVariant : null);
  const levelLabel = (v: Ship3DVariant) => t(`ship3d.level.${v.level}`, v.label ?? v.level);
  // Rendu : les assets HD gardent leurs matériaux/textures (keepMaterials) ; les assets « clay »
  // (pivot visite résine, flag `render:"clay"` sur la variante d'index) passent en matcap uniforme.
  // Piloté par l'index → aucun hardcode : un ship publié en clay bascule tout seul.
  const activeRender = (visite ? interiorVariant : mainVariant)?.render;
  const keepMaterials = activeRender !== "clay";

  // Sortie de la Visite quand on change de vaisseau.
  useEffect(() => {
    setVisite(false);
  }, [selected?.name]);

  return (
    <div className="flex h-full flex-col p-8">
      <header className="mb-4 flex shrink-0 items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Rotate3d className="h-6 w-6 text-[var(--accent)]" />
            {t("ship3d.title")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("ship3d.subtitle")}</p>
        </div>
        {models.size > 0 && (
          <span className="shrink-0 text-xs text-[#2ee9a5]">{t("ship3d.modelsAvailable", { n: models.size })}</span>
        )}
      </header>

      {loadingList ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("ship3d.loading")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("ship3d.error")} {error}
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
          {/* Liste des vaisseaux */}
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2.5 shrink-0 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ship3d.searchPlaceholder")}
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
                />
              </div>
              <Dropdown
                value={manuFilter}
                onChange={setManuFilter}
                ariaLabel={t("ship3d.manufacturer")}
                className="w-full"
                options={[
                  { value: "all", label: t("ship3d.allManufacturers") },
                  ...manufacturers.map((m) => ({ value: m, label: m })),
                ]}
              />
              <button
                onClick={() => setVisitableOnly((v) => !v)}
                aria-pressed={visitableOnly}
                className={[
                  "flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  visitableOnly
                    ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.16] text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                ].join(" ")}
              >
                <Footprints className="h-4 w-4" />
                {t("ship3d.visitableOnly")}
                <span
                  className={[
                    "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                    visitableOnly ? "bg-white/20 text-white" : "bg-white/10 text-white/70",
                  ].join(" ")}
                >
                  {visitableCount}
                </span>
              </button>
            </div>
            <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-white/40">{t("ship3d.noShips")}</p>
              ) : (
                filtered.map((s) => {
                  const sel = s.name === selName;
                  const real = hasModel(s);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelName(s.name)}
                      className={[
                        "flex items-center gap-2.5 rounded-xl border p-2 text-left transition-colors",
                        sel ? "border-accent/60 bg-accent/[0.10]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      {s.imageUrl ? (
                        <img src={s.imageUrl} alt="" loading="lazy" className="h-8 w-12 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-white/5">
                          <Box className="h-4 w-4 text-white/30" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-white">{s.name}</div>
                        <div className="truncate text-[11px] text-white/40">{s.manufacturer}</div>
                      </div>
                      {real && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-[#2ee9a5]" style={{ background: "rgba(46,233,165,0.14)" }}>
                          3D
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Détail / viewer */}
          <div className="flex min-h-0 flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/40">
                {t("ship3d.selectPrompt")}
              </div>
            ) : !model ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
                {selected.imageUrl ? (
                  <img src={selected.imageUrl} alt="" className="max-h-[220px] max-w-full rounded-xl object-contain" />
                ) : (
                  <Box className="h-10 w-10 text-white/20" />
                )}
                <p className="text-sm text-white/45">{t("ship3d.notAvailable")}</p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{selected.name}</div>
                    <div className="text-xs text-white/50">
                      {selected.manufacturer}
                      {selected.classification ? ` · ${selected.classification}` : ""}
                    </div>
                  </div>
                  {mainVariant && (
                    <div className="text-xs text-white/50">
                      {fmtTris(mainVariant.tris)} tris · {fmtMB(mainVariant.sizeBytes)}
                      {dims ? ` · ${dims.l} × ${dims.b} × ${dims.h} m` : ""}
                    </div>
                  )}
                </div>

                <div className="relative min-h-[440px] flex-1">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/50">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    }
                  >
                    {/* Un seul consommateur du modèle useGLTF à la fois (scène partagée) :
                        ShipWalk (visite) OU le viewer orbital. */}
                    {visite && blobUrl ? (
                      <ShipWalk modelUrl={blobUrl} t={t} onExit={() => setVisite(false)} keepMaterials={keepMaterials} lights={walkLights} />
                    ) : (
                      <ShipViewer3D key={blobUrl ?? "blockout"} modelUrl={blobUrl} dims={dims} t={t} keepMaterials={keepMaterials} />
                    )}
                  </Suspense>

                  {/* Bouton Visite : vaisseaux visitables (équipage ≥ 2) ayant un intérieur */}
                  {!visite && walkVariant && blobUrl && selected && isVisitable(selected) && (
                    <button
                      onClick={() => setVisite(true)}
                      className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur hover:bg-[var(--accent)]"
                    >
                      <Footprints className="h-4 w-4" />
                      {t("ship3d.walk")}
                    </button>
                  )}
                  {loading && activeVariant && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/40 backdrop-blur-sm">
                      <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                      <span className="text-sm text-white/75">
                        {t("ship3d.loadingLevel", { level: levelLabel(activeVariant), size: fmtMB(activeVariant.sizeBytes) })}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
