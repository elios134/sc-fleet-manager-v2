import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { refreshStarjumpManifest } from "../../lib/starjump";
import { SidePanelLayout } from "../../components/ui/SidePanel";
import { compareShips, type ShipDataRow } from "./compare";
import { duelVerdict } from "./lib/verdict";
import { DuelRadar, MirrorRows } from "./components/Duel";
import { DuelBar } from "./components/DuelBar";
import { VerdictBanner } from "./components/VerdictBanner";
import { LoadoutCompareView } from "./components/LoadoutCompareView";


/* Comparateur (maquette docs/design/maquettes-refonte-pages-2.html, variante A) : sélection sur une
   ligne, bandeau verdict, lignes en miroir par groupe et radar en fiche fixe. Mode Loadouts à part. */
export default function ComparatorPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipDataRow[]>([]);
  const [shipA, setShipA] = usePersistentState<ShipDataRow | null>("comparator.shipA", null);
  const [shipB, setShipB] = usePersistentState<ShipDataRow | null>("comparator.shipB", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePersistentState("comparator.search", "");
  const [mode, setMode] = usePersistentState<"ships" | "loadouts">("comparator.mode", "ships");
  const [ownedNames, setOwnedNames] = useState<Set<string>>(new Set());
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();

  // Le côté A suit dans l'URL (?ship=) : l'onglet Configurateur ouvre le même vaisseau.
  useEffect(() => {
    if (shipA) setSearchParams((p) => { p.set("ship", String(shipA.id)); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seul l'id compte ; setSearchParams change à chaque navigation (boucle)
  }, [shipA?.id]);

  // Présélection du vaisseau A si on arrive depuis la fiche détail (action « Comparer »).
  useEffect(() => {
    const name = (location.state as { preselectShipName?: string } | null)?.preselectShipName;
    if (!name || ships.length === 0) return;
    const match = ships.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (match) setShipA(match);
  }, [ships, location.state, setShipA]);

  useEffect(() => {
    let cancelled = false;
    // Rafraîchit le manifeste Starjump en arrière-plan (best-effort, bundle sinon).
    void refreshStarjumpManifest();
    (async () => {
      try {
        const data = await invoke<ShipDataRow[]>("get_all_ship_data");
        if (!cancelled) {
          setShips(data);
          // Vaisseau venu d'un autre onglet du hub Vaisseaux (?ship=<id ShipData>) → côté A.
          const fromHub = data.find((x) => x.id === Number(new URLSearchParams(location.search).get("ship")));
          if (fromHub) setShipA(fromHub);
        }
        // Noms des vaisseaux possédés (matching par nom, façon V1). Non bloquant.
        try {
          const accountId = await invoke<string | null>("get_active_account_id");
          if (accountId) {
            const owned = await invoke<{ name: string }[]>("get_insurance_ships", {
              accountId,
            });
            if (!cancelled) {
              setOwnedNames(new Set(owned.map((s) => s.name.toLowerCase())));
            }
          }
        } catch {
          /* liste possédés non bloquante */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement unique au montage ; ?ship= n'est lu qu'à l'arrivée
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ships;
    return ships.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q),
    );
  }, [ships, search]);

  function swap() {
    setShipA(shipB);
    setShipB(shipA);
  }
  function reset() {
    setShipA(null);
    setShipB(null);
  }

  const duel = useMemo(() => (shipA && shipB ? compareShips(shipA, shipB) : { rows: [], winsA: 0, winsB: 0, comparable: 0 }), [shipA, shipB]);

  function pick(id: string, setter: (s: ShipDataRow | null) => void) {
    setter(ships.find((s) => String(s.id) === id) ?? null);
  }

  return (
    <div className="p-8">
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("comparator.subtitlePrefix")}</p>
          <h1 className="text-2xl font-bold text-white">{t("comparator.title")}</h1>
        </div>
        <div role="group" aria-label={t("comparator.lo.mode")} className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-[12px] font-semibold">
          {(["ships", "loadouts"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3.5 py-1.5 ${mode === m ? "bg-[var(--accent)] text-white" : "text-white/55 hover:text-white"}`}
            >
              {t(`comparator.lo.modes.${m}`)}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("comparator.loadingShips")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("common.errorPrefix")} {error}
        </p>
      ) : mode === "loadouts" ? (
        <LoadoutCompareView ships={ships} />
      ) : (
        <>
          <DuelBar
            search={search}
            setSearch={setSearch}
            ships={filtered}
            ownedNames={ownedNames}
            shipA={shipA}
            shipB={shipB}
            onPickA={(id) => pick(id, setShipA)}
            onPickB={(id) => pick(id, setShipB)}
            onSwap={swap}
            onReset={reset}
          />
          {shipA && shipB ? (
            <>
              <VerdictBanner a={shipA} b={shipB} ownedNames={ownedNames} winsA={duel.winsA} winsB={duel.winsB} verdict={duelVerdict(duel)} />
              <SidePanelLayout panel={<DuelRadar a={shipA} b={shipB} />}>
                <MirrorRows rows={duel.rows} />
              </SidePanelLayout>
            </>
          ) : (
            <p className="text-sm text-white/40">{t("comparator.selectTwoShips")}</p>
          )}
        </>
      )}
    </div>
  );
}
