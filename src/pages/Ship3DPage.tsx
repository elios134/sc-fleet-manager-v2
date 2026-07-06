import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Search, Rotate3d, Box, Check, Footprints } from "lucide-react";
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
  type Ship3DLevel,
} from "../lib/ship3d";
import type { ShipPart } from "../components/ship3d/ShipViewer3D";

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

export default function Ship3DPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [models, setModels] = useState<Map<string, Ship3DShip>>(new Map());
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePersistentState("ship3d.search", "");
  const [selName, setSelName] = usePersistentState<string | null>("ship3d.selected", null);
  const [level, setLevel] = usePersistentState<Ship3DLevel>("ship3d.level", "exterior");
  const [hullOpacity, setHullOpacity] = useState(1);
  const [part, setPart] = useState("all");
  const [parts, setParts] = useState<ShipPart[]>([]);
  const [visite, setVisite] = useState(false); // mode Visite 1re personne (collision)
  const onParts = useCallback((p: ShipPart[]) => setParts(p), []);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    const uniq = ships.filter((s) =>
      EXCLUDED_VARIANTS.test(s.name) ? false : seen.has(s.name) ? false : (seen.add(s.name), true),
    );
    return uniq
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ships, search]);

  const selected = useMemo(() => ships.find((s) => s.name === selName) ?? null, [ships, selName]);
  const model = selected ? models.get(normalizeShipKey(selected.name)) : undefined;
  const variants = model ? sortedVariants(model) : [];
  // On masque le niveau « silhouette » (fusionné dans « Aperçu » = exterior).
  // INTÉRIEUR : activé au cas par cas, seulement pour les vaisseaux dont le placement des
  // modules intérieurs a été validé (harnais debug3d : centre bbox de la coque de chaque
  // module = son hardpoint_int_*). L'export upstream (StarBreaker) plaçait mal les modules
  // (bug ×2) ; asset-3d corrige via reposition sur hardpoint_int_*. Cutlass = corrigé + validé
  // (sha 1281aa58) ; Idris = en attente de sa table d'ancrage. Ajouter la clé normalisée ici
  // une fois un intérieur validé. Repli : si un vaisseau n'a QUE des niveaux masqués, on les
  // garde pour ne pas afficher zéro bouton.
  // Cutlass validé (sha 04c4f9ce) : centre X/Z sur hardpoint_int_* + plancher sur le pont
  // (cargogrid), plus de soute qui pend.
  // Idris : validation visuelle KO — tourelles gauche non emboîtées (LOD3 brut). Remis OFF, en
  // attente d'un fix asset-3d/StarBreaker. Réactiver quand les tourelles s'emboîtent.
  const INTERIOR_VALIDATED = new Set<string>(["cutlass-black"]);
  const interiorOk =
    !!model &&
    (INTERIOR_VALIDATED.has(normalizeShipKey(model.name)) ||
      (model.key ? INTERIOR_VALIDATED.has(normalizeShipKey(model.key)) : false));
  const displayVariants = variants.filter(
    (v) => v.level !== "silhouette" && (interiorOk || v.level !== "interior"),
  );
  const shown = displayVariants.length ? displayVariants : variants;
  const effLevel = shown.some((v) => v.level === level) ? level : shown[0]?.level ?? "exterior";
  const currentVariant = shown.find((v) => v.level === effLevel) ?? null;
  const dims =
    selected && selected.length != null && selected.beam != null && selected.height != null
      ? { l: selected.length, b: selected.beam, h: selected.height }
      : model?.dims ?? null;
  const hasModel = (s: ShipRow) => models.has(normalizeShipKey(s.name));

  const { blobUrl, loading, loaded } = useShipModel(currentVariant);
  const levelLabel = (v: Ship3DVariant) => t(`ship3d.level.${v.level}`, v.label ?? v.level);
  const partLabel = (p: ShipPart) =>
    p.hull
      ? t("ship3d.partHull")
      : p.name.replace(/^interior_(base_int_|ext_)?/i, "").replace(/_main$/i, "").replace(/_/g, " ").trim() || p.name;

  // Réinitialise à chaque changement de vaisseau/niveau. Coque OPAQUE par défaut (y compris
  // en Intérieur) : la semi-transparence superposait coque + modules intérieurs (effet
  // « double soute »). On entre dans le vaisseau via le zoom ; le slider fond la coque à la demande.
  useEffect(() => {
    setHullOpacity(1);
    setPart("all");
    setParts([]);
    setVisite(false);
  }, [currentVariant?.sha256, currentVariant?.level]);

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
            <div className="relative mb-2.5 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("ship3d.searchPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
              />
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
                  {currentVariant && (
                    <div className="text-xs text-white/50">
                      {fmtTris(currentVariant.tris)} tris · {fmtMB(currentVariant.sizeBytes)}
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
                      <ShipWalk modelUrl={blobUrl} t={t} onExit={() => setVisite(false)} />
                    ) : (
                      <ShipViewer3D
                        key={blobUrl ?? "blockout"}
                        modelUrl={blobUrl}
                        dims={dims}
                        t={t}
                        hullOpacity={hullOpacity}
                        part={part}
                        onParts={onParts}
                      />
                    )}
                  </Suspense>

                  {/* Bouton Visite : mode Intérieur, modèle chargé, hors visite */}
                  {!visite && effLevel === "interior" && blobUrl && (
                    <button
                      onClick={() => setVisite(true)}
                      className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur hover:bg-[var(--accent)]"
                    >
                      <Footprints className="h-4 w-4" />
                      {t("ship3d.walk")}
                    </button>
                  )}
                  {loading && currentVariant && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/40 backdrop-blur-sm">
                      <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                      <span className="text-sm text-white/75">
                        {t("ship3d.loadingLevel", { level: levelLabel(currentVariant), size: fmtMB(currentVariant.sizeBytes) })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Barre des niveaux de détail (uniquement ceux présents) */}
                <div className="mt-3 flex gap-2">
                  {shown.map((v) => {
                    const active = v.level === effLevel;
                    const isCached = !!v.sha256 && loaded.has(v.sha256);
                    return (
                      <button
                        key={v.level}
                        onClick={() => setLevel(v.level)}
                        className={[
                          "flex-1 rounded-xl border p-2.5 text-left transition-colors",
                          active
                            ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.16] text-white"
                            : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-1.5 text-[13px] font-medium">
                          {levelLabel(v)}
                          {isCached && <Check className="h-3.5 w-3.5 text-[#34d399]" />}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-white/40">
                          {fmtMB(v.sizeBytes)} · {fmtTris(v.tris)} tris
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Contrôles intérieur uniquement : opacité de la coque + isolation d'une partie */}
                {effLevel === "interior" && parts.length > 1 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/60">
                    <label className="flex items-center gap-2">
                      <span>{t("ship3d.hullOpacity")}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(hullOpacity * 100)}
                        onChange={(e) => setHullOpacity(Number(e.target.value) / 100)}
                        className="accent-[var(--accent)]"
                        style={{ width: 130 }}
                      />
                      <span className="w-9 tabular-nums text-white/40">{Math.round(hullOpacity * 100)}%</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <span>{t("ship3d.part")}</span>
                      <Dropdown
                        value={part}
                        onChange={setPart}
                        ariaLabel={t("ship3d.part")}
                        className="w-56"
                        buttonClassName="text-xs text-white/80"
                        options={[
                          { value: "all", label: t("ship3d.allParts") },
                          ...parts.map((p) => ({ value: p.id, label: partLabel(p) })),
                        ]}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
