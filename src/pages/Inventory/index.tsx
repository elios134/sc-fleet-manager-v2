import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { usePersistentState } from "../../lib/uiPersist";
import type { InvState, InventoryStatus } from "./types";
import type { BodyRef } from "./resolve";
import { buildScopeTree, rowsForMoi, rowsForPlace } from "./aggregate";
import { ScopeSelects, type Scope } from "./components/ScopeSelects";
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
  const [importing, setImporting] = useState(false);

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

  const tree = useMemo(() => buildScopeTree(state, bodies), [state, bodies]);
  const rows = useMemo(
    () => (scope.mode === "moi" ? rowsForMoi(state) : rowsForPlace(state, scope.locId)),
    [state, scope],
  );
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

      {status && !status.hasGameLog ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/50">
          Star Citizen introuvable. Le suivi lit le Game.log de ton installation ; lance le jeu une fois pour qu'il soit détecté.
        </div>
      ) : vide ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur">
          <ScopeSelects tree={tree} scope={scope} onChange={setScope} />
          <label className="flex items-center gap-2 rounded-[10px] border border-white/16 bg-white/[0.03] px-3 py-2">
            <svg className="h-4 w-4 stroke-white/40" viewBox="0 0 24 24" fill="none" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer un objet dans ce scope…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InventoryList rows={rows} query={query} />
          </div>
        </div>
      )}

      <p className="shrink-0 text-[11px] text-white/35">
        Inventaire reconstruit depuis le Game.log (lecture seule). Les quantités reflètent ce que le jeu a tracé, pas un relevé serveur.
      </p>
    </div>
  );
}
