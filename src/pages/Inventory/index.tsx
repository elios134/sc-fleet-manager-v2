import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { usePersistentState } from "../../lib/uiPersist";
import type { InvState, InventoryStatus, ItemMeta } from "./types";
import type { BodyRef } from "./resolve";
import { applyMeta, buildScopeTree, rowsForMoi, rowsForPlace, summarize } from "./aggregate";
import { ScopeRail, type Scope } from "./components/ScopeRail";
import { ItemTiles } from "./components/ItemTiles";
import { LayoutGrid, List } from "lucide-react";
import { InventoryList } from "./components/InventoryList";

const EMPTY: InvState = { possessions: {}, sol: {}, lieux: {}, contenants: {}, derniereTrace: null, journalId: null, journalPos: 0, curLocNom: null };

type StarBody = { name: string; systemName: string; navIcon: string; parentRef: string | null };

export default function InventoryPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<InventoryStatus | null>(null);
  const [state, setState] = useState<InvState>(EMPTY);
  const [bodies, setBodies] = useState<BodyRef[]>([]);
  const [scope, setScope] = usePersistentState<Scope>("inventory.scope", { mode: "moi" });
  const [query, setQuery] = useState("");
  const [view, setView] = usePersistentState<"tiles" | "list">("inventory.view", "tiles");
  const [importing, setImporting] = useState(false);
  const [meta, setMeta] = useState<Record<string, ItemMeta>>({});

  const reload = useCallback(() => {
    invoke<InvState>("inventory_state").then(setState).catch(() => setState(EMPTY));
    invoke<InventoryStatus>("inventory_status").then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    reload();
    invoke<StarBody[]>("get_starmap_bodies")
      .then((bs) => setBodies(bs.map((b) => ({ name: b.name, system: b.systemName, parentBody: b.parentRef, navIcon: b.navIcon }))))
      .catch(() => setBodies([]));
    const un = listen("inventory:updated", () => reload());
    return () => { void un.then((f) => f()); };
  }, [reload]);

  // Nom réel + image + catégorie (SC Wiki, mis en cache côté Rust) des classes suivies.
  const classesKey = useMemo(
    () => [...new Set(Object.values(state.possessions).flatMap((inv) => Object.keys(inv)))].sort().join("|"),
    [state],
  );
  useEffect(() => {
    if (!classesKey) return;
    invoke<Record<string, ItemMeta>>("inventory_item_meta", { classes: classesKey.split("|") })
      .then(setMeta)
      .catch(() => { /* hors-ligne : repli nom deviné + icône */ });
  }, [classesKey]);

  const tree = useMemo(() => buildScopeTree(state, bodies), [state, bodies]);
  const rows = useMemo(
    () => applyMeta(scope.mode === "moi" ? rowsForMoi(state) : rowsForPlace(state, scope.locId), meta),
    [state, scope, meta],
  );
  const summary = useMemo(() => summarize(rows), [rows]);
  const scopeTitle =
    scope.mode === "moi"
      ? t("inventory.onMe")
      : Object.values(tree.placesByPlanet).flat().find((p) => p.locId === scope.locId)?.name ?? t("inventory.title");
  const frais = status?.derniereTrace != null && Date.now() / 1000 - status.derniereTrace < 600;
  const vide = tree.systems.length === 0 && tree.moiCount === 0;

  const doImport = async () => {
    setImporting(true);
    try { await invoke("inventory_import_history"); reload(); } catch { /* SC absent : rien */ }
    finally { setImporting(false); }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex shrink-0 flex-wrap items-baseline gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("inventory.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("inventory.title")}</h1>
        <span className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-white/55">
          <span className={`h-[7px] w-[7px] rounded-full ${frais ? "bg-emerald-400" : "bg-white/40"}`} />
          {frais ? t("inventory.trackingActive") : t("inventory.trackingWaiting")}
        </span>
      </header>

      {status && status.hasGameLog && !status.active && (
        <p className="shrink-0 rounded-2xl border border-[var(--amber)]/45 bg-[var(--amber-muted)] px-4 py-3 text-[13px] text-amber-200">
          {t("inventory.liveOff")}
        </p>
      )}

      {status && !status.hasGameLog ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-white/50">
          Star Citizen introuvable. Le suivi lit le Game.log de ton installation ; lance le jeu une fois pour qu'il soit détecté.
        </div>
      ) : vide ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl glass p-8 text-center">
          <p className="max-w-md text-sm text-white/50">
            Aucun objet suivi pour l'instant. Importe l'historique (relecture des journaux de jeu) ou joue : tes mouvements d'objets rempliront l'inventaire.
          </p>
          <button
            type="button"
            onClick={doImport}
            disabled={importing}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {importing ? "Import en cours…" : "Importer l'historique"}
          </button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[270px_minmax(0,1fr)] lg:items-start">
          <ScopeRail tree={tree} scope={scope} onChange={setScope} />
          <div className="flex min-w-0 flex-col gap-3">
            <div className="glass flex flex-wrap items-center gap-3.5 rounded-2xl px-4 py-3.5">
              <div className="flex flex-col">
                <b className="text-[17px] text-white">{scopeTitle}</b>
                <span className="text-xs text-white/55">{t("inventory.scopeSummary", summary)}</span>
              </div>
              <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-[10px] border border-white/16 bg-white/[0.03] px-3 py-2">
                <svg className="h-4 w-4 stroke-white/40" viewBox="0 0 24 24" fill="none" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("inventory.filterPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
                />
              </label>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-white/16" role="group" aria-label={t("inventory.viewLabel")}>
                <button type="button" aria-pressed={view === "tiles"} title={t("inventory.viewTiles")} onClick={() => setView("tiles")} className={`grid place-items-center px-2.5 py-2 ${view === "tiles" ? "bg-[var(--accent)]/20 text-white" : "text-white/55"}`}><LayoutGrid className="h-4 w-4" /></button>
                <button type="button" aria-pressed={view === "list"} title={t("inventory.viewList")} onClick={() => setView("list")} className={`grid place-items-center px-2.5 py-2 ${view === "list" ? "bg-[var(--accent)]/20 text-white" : "text-white/55"}`}><List className="h-4 w-4" /></button>
              </div>
            </div>
            {view === "tiles" ? <ItemTiles rows={rows} query={query} /> : <div className="glass rounded-2xl"><InventoryList rows={rows} query={query} /></div>}
          </div>
        </div>
      )}

      <p className="shrink-0 text-[11px] text-white/35">
        Inventaire reconstruit depuis le Game.log (lecture seule). Les quantités reflètent ce que le jeu a tracé, pas un relevé serveur.
      </p>
    </div>
  );
}
