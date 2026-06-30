import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Boxes, Loader2, Plus, Wand2, X } from "lucide-react";
import type { LoadToHoldRequest } from "../pages/CargoRoutesPage";
import Dropdown from "./ui/Dropdown";
import Hold3D from "./cargo/Hold3D";
import { usePersistentState } from "../lib/uiPersist";

/* ── Types (miroir Rust) ── */
type FleetShip = { name: string; manufacturer: string | null; cargoScu: number | null; role: string | null };
type ShipGroup = "fleet" | "all";
type Container = { sizeScu: number; count: number };
type CargoGridResult = {
  shipName: string;
  found: boolean;
  tentative: boolean;
  totalScu: number;
  containerCount: number;
  containers: Container[];
};
type ManifestItem = { id: number; commodity: string; scu: number };
type Cell = { id: number; sizeScu: number; commodity: string | null };

const PALETTE = ["#f5a623", "#2ee9a5", "#378add", "#d4537e", "#5dcaa5", "#a78bfa", "#f97316", "#22d3ee"];
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

export function CargoGridTab({ loadRequest }: { loadRequest: LoadToHoldRequest | null }) {
  const { t } = useTranslation();
  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<FleetShip[]>([]);
  const [group, setGroup] = usePersistentState<ShipGroup>("cargoGrid.group", "fleet");
  const [shipName, setShipName] = usePersistentState("cargoGrid.ship", "");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [grid, setGrid] = useState<CargoGridResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manifeste = liste à empoter (travail de l'utilisateur) → persisté.
  const [manifest, setManifest] = usePersistentState<ManifestItem[]>("cargoGrid.manifest", []);
  const [newCommodity, setNewCommodity] = useState("");
  const [newScu, setNewScu] = useState("");
  const [cells, setCells] = useState<Cell[]>([]); // conteneurs aplatis + assignation

  // Pré-remplissage depuis le planificateur ("Charger dans la soute").
  const appliedNonce = useRef<number | null>(null);
  const [pendingFill, setPendingFill] = useState(false);
  // Au montage avec une demande de chargement : ne pas pré-sélectionner le 1er vaisseau.
  const hasInitialLoad = useRef(loadRequest != null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, catalog] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<FleetShip[]>("get_cargo_catalog_ships"),
        ]);
        if (!alive) return;
        setFleetShips(fleet);
        setCatalogShips(catalog);
        // Pré-sélection par défaut seulement sans demande de chargement (sinon
        // l'effet loadRequest pilote le vaisseau/groupe/manifeste) ET seulement si rien
        // n'a été restauré (sessionStorage) → on garde la sélection persistée.
        if (!hasInitialLoad.current && !shipName) {
          if (fleet.length > 0) {
            setGroup("fleet");
            setShipName(fleet[0].name);
          } else if (catalog.length > 0) {
            setGroup("all");
            setShipName(catalog[0].name);
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ships = group === "fleet" ? fleetShips : catalogShips;

  // Charge la composition à chaque changement de vaisseau ; réinitialise l'assignation.
  useEffect(() => {
    if (!shipName) {
      setGrid(null);
      setCells([]);
      return;
    }
    let alive = true;
    invoke<CargoGridResult>("get_cargo_grid", { shipName })
      .then((g) => {
        if (!alive) return;
        setGrid(g);
        setCells(flatten(g));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [shipName]);

  // Applique une demande "Charger dans la soute" une fois les listes chargées.
  // Sélectionne le vaisseau de la route, pré-remplit le manifeste (1 entrée) et
  // programme l'auto-remplissage best-fit.
  useEffect(() => {
    if (!loadRequest || loadingMeta) return;
    if (appliedNonce.current === loadRequest.nonce) return;
    appliedNonce.current = loadRequest.nonce;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const inFleet = fleetShips.some((s) => norm(s.name) === norm(loadRequest.shipName));
    setGroup(inFleet ? "fleet" : "all");
    setShipName(loadRequest.shipName);
    setManifest([{ id: Date.now(), commodity: loadRequest.commodity, scu: loadRequest.scu }]);
    setPendingFill(true);
  }, [loadRequest, loadingMeta, fleetShips]);

  // Une fois la grille du vaisseau demandé chargée, déclenche l'auto-remplissage.
  useEffect(() => {
    if (!pendingFill || !grid || !loadRequest) return;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm(grid.shipName) !== norm(loadRequest.shipName)) return; // grille pas encore à jour
    if (grid.found && cells.length > 0) {
      autoFill();
    }
    // Grille introuvable : on garde le manifeste pré-rempli visible (pas de crash).
    setPendingFill(false);
  }, [pendingFill, grid, cells, loadRequest]);

  function switchGroup(g: ShipGroup) {
    setGroup(g);
    const list = g === "fleet" ? fleetShips : catalogShips;
    setShipName(list.length > 0 ? list[0].name : "");
  }

  // Conteneurs occupés / SCU utilisés.
  const occupied = cells.filter((c) => c.commodity != null);
  const usedScu = occupied.reduce((a, c) => a + c.sizeScu, 0); // capacité occupée
  const total = grid?.totalScu ?? 0;
  const freeScu = Math.max(0, total - usedScu);
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    manifest.forEach((it, i) => m.set(it.commodity, PALETTE[i % PALETTE.length]));
    return m;
  }, [manifest]);

  function addManifest() {
    const scu = Number(newScu);
    if (!newCommodity.trim() || !Number.isFinite(scu) || scu <= 0) return;
    setManifest((m) => [...m, { id: Date.now(), commodity: newCommodity.trim(), scu }]);
    setNewCommodity("");
    setNewScu("");
  }
  function removeManifest(id: number) {
    setManifest((m) => m.filter((x) => x.id !== id));
  }
  function loadExample() {
    if (!grid || total <= 0) return;
    // Exemple : 2-3 marchandises ~ remplissant le vaisseau.
    const a = Math.round(total * 0.5);
    const b = Math.round(total * 0.3);
    setManifest([
      { id: 1, commodity: "Laranite", scu: a },
      { id: 2, commodity: "Titanium", scu: b },
    ]);
  }
  function clearManifest() {
    setManifest([]);
    if (grid) setCells(flatten(grid));
  }

  // Best-fit (first-fit décroissant) : remplit d'abord les plus gros conteneurs.
  function autoFill() {
    if (!grid) return;
    const next = flatten(grid); // conteneurs triés desc par taille
    const items = [...manifest].sort((x, y) => y.scu - x.scu);
    for (const it of items) {
      let need = it.scu;
      for (const c of next) {
        if (need <= 0) break;
        if (c.commodity == null) {
          c.commodity = it.commodity;
          need -= c.sizeScu;
        }
      }
    }
    setCells(next);
  }

  const manifestTotal = manifest.reduce((a, m) => a + m.scu, 0);
  const overCapacity = manifestTotal > total && total > 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={t("cargo.grid.total")} value={grid?.found ? `${fmt(total)} SCU` : "—"} />
        <StatCard label={t("cargo.grid.used")} value={grid?.found ? `${fmt(usedScu)} SCU` : "—"} accent="amber" />
        <StatCard label={t("cargo.grid.free")} value={grid?.found ? `${fmt(freeScu)} SCU` : "—"} accent="green" />
        <StatCard
          label={t("cargo.grid.containers")}
          value={grid?.found ? `${occupied.length} / ${grid.containerCount}` : "—"}
        />
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Colonne gauche : sélecteur + manifeste */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.grid.shipAndManifest")}
          </p>

          {loadingMeta ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : fleetShips.length === 0 && catalogShips.length === 0 ? (
            <p className="text-sm text-white/50">{t("cargo.empty.noShips")}</p>
          ) : (
            <>
              <Field label={t("cargo.form.group")}>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => switchGroup("fleet")}
                    disabled={fleetShips.length === 0}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                      group === "fleet" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupFleet")} ({fleetShips.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => switchGroup("all")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      group === "all" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupAll")} ({catalogShips.length})
                  </button>
                </div>
              </Field>

              <Field label={t("cargo.form.ship")}>
                <Dropdown
                  value={shipName}
                  onChange={setShipName}
                  ariaLabel={t("cargo.form.ship")}
                  options={ships.map((s) => ({
                    value: s.name,
                    label: `${s.name}${s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}`,
                  }))}
                />
              </Field>

              {grid && !grid.found && (
                <p className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-accent">
                  {t("cargo.grid.notInGuide", { ship: shipName })}
                </p>
              )}
              {grid?.tentative && (
                <p className="mb-3 text-[11px] text-accent/80">{t("cargo.grid.tentative")}</p>
              )}

              {/* Manifeste */}
              <div className="mt-2 border-t border-white/10 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-white/40">{t("cargo.grid.manifest")}</span>
                  <button
                    type="button"
                    onClick={loadExample}
                    disabled={!grid?.found}
                    className="text-[11px] text-[var(--accent)] hover:underline disabled:opacity-40"
                  >
                    {t("cargo.grid.example")}
                  </button>
                </div>

                <div className="mb-2 flex flex-col gap-1.5">
                  {manifest.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1.5 text-sm">
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: colorOf.get(it.commodity) }}
                      />
                      <span className="min-w-0 flex-1 truncate capitalize text-white/80">{it.commodity}</span>
                      <span className="text-white/60">{fmt(it.scu)} SCU</span>
                      <button onClick={() => removeManifest(it.id)} className="text-white/30 hover:text-white/70">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {manifest.length === 0 && <p className="text-[12px] text-white/30">{t("cargo.grid.manifestEmpty")}</p>}
                </div>

                <div className="flex gap-2">
                  <input
                    value={newCommodity}
                    onChange={(e) => setNewCommodity(e.target.value)}
                    placeholder={t("cargo.grid.commodity")}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white focus:outline-none"
                  />
                  <input
                    value={newScu}
                    onChange={(e) => setNewScu(e.target.value)}
                    type="number"
                    min={1}
                    placeholder="SCU"
                    className="w-20 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addManifest}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/70 hover:bg-white/10"
                    aria-label={t("cargo.grid.add")}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {/* Barre de remplissage */}
                {grid?.found && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11px] text-white/40">
                      <span>{t("cargo.grid.fill")}</span>
                      <span className={overCapacity ? "text-red-300" : ""}>
                        {fmt(Math.min(manifestTotal, total))} / {fmt(total)} SCU
                        {overCapacity ? ` · ${t("cargo.grid.over")}` : ""}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${total > 0 ? Math.min(100, (manifestTotal / total) * 100) : 0}%`,
                          background: overCapacity ? "rgb(248 113 113)" : "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={autoFill}
                    disabled={!grid?.found || manifest.length === 0}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Wand2 className="h-4 w-4" />
                    {t("cargo.grid.autoFill")}
                  </button>
                  <button
                    type="button"
                    onClick={clearManifest}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                  >
                    {t("cargo.grid.clear")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Colonne droite : vue pseudo-iso des conteneurs */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">{t("cargo.grid.holdView")}</p>
            <p className="text-[10px] text-white/30">{t("cargo.grid.approx")}</p>
          </div>

          {!grid?.found ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-white/40">
              <Boxes className="h-8 w-8 opacity-40" />
              <p className="text-sm">{grid ? t("cargo.grid.notInGuideShort") : t("cargo.grid.pickShip")}</p>
            </div>
          ) : (
            <>
              <Hold3D cells={cells} colorOf={colorOf} />

              {/* Légende marchandises */}
              {manifest.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3">
                  {manifest.map((it) => (
                    <span key={it.id} className="flex items-center gap-1.5 text-[11px] text-white/60">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf.get(it.commodity) }} />
                      <span className="capitalize">{it.commodity}</span>
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                    <span className="h-2.5 w-2.5 rounded-sm border border-white/20 bg-white/5" />
                    {t("cargo.grid.freeLabel")}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Helpers ── */
function flatten(g: CargoGridResult): Cell[] {
  const out: Cell[] = [];
  let id = 0;
  for (const c of g.containers) {
    for (let i = 0; i < c.count; i++) out.push({ id: id++, sizeScu: c.sizeScu, commodity: null });
  }
  // tri desc par taille (best-fit + lisibilité)
  out.sort((a, b) => b.sizeScu - a.sizeScu);
  return out;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "amber" | "green" }) {
  const color = accent === "amber" ? "text-[var(--accent)]" : accent === "green" ? "text-emerald-400" : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.1em] text-white/40">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-white/40">{label}</div>
      {children}
    </div>
  );
}
