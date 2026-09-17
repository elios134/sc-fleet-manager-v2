import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Box, Users, Package } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import {
  fetchShip3DIndex,
  indexShipsByName,
  normalizeShipKey,
  sortedVariants,
  type Ship3DShip,
  type Ship3DVariant,
} from "../../lib/ship3d";
import { dedupShips, fmtMB, hasModel as hasModelFn, makeIsVisitable } from "./helpers";
import { useShipLights, useShipModel } from "./hooks";
import type { ShipRow, SpecItem } from "./types";
import ShipIdentity from "./components/ShipIdentity";
import SpecsRail from "./components/SpecsRail";
import ViewerTools from "./components/ViewerTools";
import ShipDock from "./components/ShipDock";
import CatalogOverlay from "./components/CatalogOverlay";

/* Onglet « Vaisseaux 3D » — layout « Hangar Bay » : le viewer three.js occupe tout le cadre,
   la découverte (dock bas + catalogue plein écran) et la fiche (HUD identité + specs) flottent
   par-dessus. Chaque vaisseau expose jusqu'à 3 niveaux via la mini-API asset-3d ; Aperçu
   extérieur par défaut, Visite 1re personne (collision) à la demande. */

const ShipViewer3D = lazy(() => import("../../components/ship3d/ShipViewer3D"));
const ShipWalk = lazy(() => import("../../components/ship3d/ShipWalk"));

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
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Barre d'outils du viewer orbital.
  const [autoRotate, setAutoRotate] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

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

  const isVisitable = useMemo(() => makeIsVisitable(models), [models]);
  const hasModel = (s: ShipRow) => hasModelFn(models, s.name);

  const dedup = useMemo(() => dedupShips(ships), [ships]);
  const manufacturers = useMemo(
    () => Array.from(new Set(dedup.map((s) => s.manufacturer).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dedup],
  );
  const stats = useMemo(
    () => ({
      total: dedup.length,
      with3d: dedup.filter((s) => hasModelFn(models, s.name)).length,
      visitable: dedup.filter(isVisitable).length,
    }),
    [dedup, models, isVisitable],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dedup
      .filter((s) => !visitableOnly || isVisitable(s))
      .filter((s) => manuFilter === "all" || s.manufacturer === manuFilter)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dedup, search, manuFilter, visitableOnly, isVisitable]);

  const selected = useMemo(() => ships.find((s) => s.name === selName) ?? null, [ships, selName]);
  const model = selected ? models.get(normalizeShipKey(selected.name)) : undefined;
  const variants = model ? sortedVariants(model) : [];
  // Vue par défaut = Aperçu EXTÉRIEUR (propre/optimisé) ; intérieurs réservés à la Visite 1re personne.
  const exteriorVariant = variants.find((v) => v.level === "exterior") ?? null;
  const interiorVariant = variants.find((v) => v.level === "interior") ?? null;
  const mainVariant = exteriorVariant ?? interiorVariant ?? null;
  const walkVariant = interiorVariant;
  const activeVariant: Ship3DVariant | null = visite && walkVariant ? walkVariant : mainVariant;
  const dims =
    selected && selected.length != null && selected.beam != null && selected.height != null
      ? { l: selected.length, b: selected.beam, h: selected.height }
      : model?.dims ?? null;

  // Bande de specs (vitrine, orientée joueur) : chaque tuile n'apparaît que si la donnée existe.
  const specItems = useMemo<SpecItem[]>(() => {
    if (!selected) return [];
    const items: SpecItem[] = [];
    const cmin = selected.crewMin;
    const cmax = selected.crewMax;
    const crew = cmin != null && cmax != null && cmin !== cmax ? `${cmin}–${cmax}` : cmax ?? cmin;
    if (crew != null) items.push({ k: t("ship3d.spec.crew"), v: String(crew), icon: <Users className="h-3 w-3" /> });
    if (selected.cargoScu != null && selected.cargoScu > 0)
      items.push({ k: t("ship3d.spec.cargo"), v: String(selected.cargoScu), u: "SCU", icon: <Package className="h-3 w-3" /> });
    if (dims) {
      items.push({ k: t("ship3d.spec.length"), v: String(dims.l), u: "m" });
      items.push({ k: t("ship3d.spec.beam"), v: String(dims.b), u: "m" });
      items.push({ k: t("ship3d.spec.height"), v: String(dims.h), u: "m" });
    }
    return items;
  }, [selected, dims, t]);

  const { blobUrl, loading } = useShipModel(activeVariant);
  const walkLights = useShipLights(visite ? walkVariant : null);
  const levelLabel = (v: Ship3DVariant) => t(`ship3d.level.${v.level}`, v.label ?? v.level);
  // Assets HD → matériaux/textures gardés ; assets « clay » (render:"clay") → matcap uniforme.
  const activeRender = (visite ? interiorVariant : mainVariant)?.render;
  const keepMaterials = activeRender !== "clay";

  useEffect(() => {
    setVisite(false);
  }, [selected?.name]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewerRef.current?.requestFullscreen?.();
  };

  const selectShip = (name: string) => setSelName(name);
  const walkable = selected ? isVisitable(selected) : false;
  const showHud = !!selected && !!model && !visite;

  return (
    <div className="flex h-full flex-col p-6">
      {loadingList ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("ship3d.loading")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("ship3d.error")} {error}
        </p>
      ) : (
        <div
          ref={viewerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(900px_520px_at_50%_6%,rgba(99,102,241,0.10),transparent_60%),linear-gradient(180deg,#0b0c15,#070709)]"
        >
          {/* Scène 3D (ou états vides) */}
          {!selected ? (
            <div className="flex h-full items-center justify-center px-8 pb-40 text-center text-sm text-white/40">
              {t("ship3d.selectPrompt")}
            </div>
          ) : !model ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 pb-40 text-center">
              {selected.imageUrl ? (
                <img src={selected.imageUrl} alt="" className="max-h-[240px] max-w-full rounded-xl object-contain" />
              ) : (
                <Box className="h-10 w-10 text-white/20" />
              )}
              <p className="text-sm text-white/45">{t("ship3d.notAvailable")}</p>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-white/50">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              }
            >
              {/* Un seul consommateur useGLTF à la fois : ShipWalk (visite) OU le viewer orbital. */}
              {visite && blobUrl ? (
                <ShipWalk modelUrl={blobUrl} t={t} onExit={() => setVisite(false)} keepMaterials={keepMaterials} lights={walkLights} />
              ) : (
                <ShipViewer3D
                  key={blobUrl ?? "blockout"}
                  modelUrl={blobUrl}
                  dims={dims}
                  t={t}
                  keepMaterials={keepMaterials}
                  autoRotate={autoRotate}
                  fitSignal={fitSignal}
                  paused={catalogOpen}
                />
              )}
            </Suspense>
          )}

          {/* HUD superposé (masqué en Visite) */}
          {showHud && (
            <ShipIdentity
              ship={selected}
              walkable={walkable}
              onEnterInterior={walkable && walkVariant && blobUrl ? () => setVisite(true) : undefined}
              t={t}
            />
          )}
          {showHud && <SpecsRail items={specItems} />}

          {!visite && (
            <ViewerTools
              autoRotate={autoRotate}
              onToggleAutoRotate={() => setAutoRotate((v) => !v)}
              onRecenter={() => setFitSignal((n) => n + 1)}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onOpenCatalog={() => setCatalogOpen(true)}
              t={t}
            />
          )}

          {!visite && (
            <ShipDock
              search={search}
              setSearch={setSearch}
              manuFilter={manuFilter}
              setManuFilter={setManuFilter}
              manufacturers={manufacturers}
              visitableOnly={visitableOnly}
              setVisitableOnly={setVisitableOnly}
              visitableCount={stats.visitable}
              totalCount={stats.total}
              filtered={filtered}
              selName={selName}
              onSelect={selectShip}
              hasModel={hasModel}
              isVisitable={isVisitable}
              t={t}
            />
          )}

          <CatalogOverlay
            open={catalogOpen}
            onClose={() => setCatalogOpen(false)}
            filtered={filtered}
            stats={stats}
            selName={selName}
            onSelect={selectShip}
            hasModel={hasModel}
            isVisitable={isVisitable}
            t={t}
          />

          {/* Voile de chargement du niveau (téléchargement Rust + cache). */}
          {loading && activeVariant && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
              <span className="text-sm text-white/75">
                {t("ship3d.loadingLevel", { level: levelLabel(activeVariant), size: fmtMB(activeVariant.sizeBytes) })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
