import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Loader2, Rocket } from "lucide-react";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../../lib/starjump";
import Dropdown, { type DropdownOption, type DropdownGroup } from "../../components/ui/Dropdown";
import { compareShips, type ShipDataRow } from "./compare";
import { DuelCard, DuelRadar, MirrorRows } from "./components/Duel";
import { LoadoutCompareView } from "./components/LoadoutCompareView";


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
  }, [shipA?.id]);

  // Présélection du vaisseau A si on arrive depuis la fiche détail (action « Comparer »).
  useEffect(() => {
    const name = (location.state as { preselectShipName?: string } | null)?.preselectShipName;
    if (!name || ships.length === 0) return;
    const match = ships.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (match) setShipA(match);
  }, [ships, location.state]);

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
          {/* Recherche */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("comparator.filterPlaceholder")}
            className="mb-4 w-full max-w-sm rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />

          {/* Pickers + swap */}
          <section className="mb-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <ShipSelect label={t("comparator.shipA")} value={shipA} ships={filtered} ownedNames={ownedNames} onChange={(id) => pick(id, setShipA)} />
            <button
              onClick={swap}
              disabled={!shipA && !shipB}
              title={t("comparator.swapTitle")}
              className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40 sm:self-end"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <ShipSelect label={t("comparator.shipB")} value={shipB} ships={filtered} ownedNames={ownedNames} onChange={(id) => pick(id, setShipB)} />
          </section>

          {!shipA && !shipB ? (
            <p className="text-sm text-white/40">{t("comparator.selectTwoShips")}</p>
          ) : null}

          {shipA && shipB && (
            <>
              <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_290px_minmax(0,1fr)]">
                <DuelCard side="a" ship={shipA} owned={ownedNames.has(shipA.name.toLowerCase())} wins={duel.winsA} comparable={duel.comparable}>
                  <ShipTopDown name={shipA.name} accent="#6366f1" />
                </DuelCard>
                <DuelRadar a={shipA} b={shipB} />
                <DuelCard side="b" ship={shipB} owned={ownedNames.has(shipB.name.toLowerCase())} wins={duel.winsB} comparable={duel.comparable}>
                  <ShipTopDown name={shipB.name} accent="#fb923c" />
                </DuelCard>
              </div>
              <MirrorRows rows={duel.rows} />

              <button
                onClick={reset}
                className="mt-6 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                {t("comparator.resetBtn")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ShipSelect({
  label,
  value,
  ships,
  ownedNames,
  onChange,
}: {
  label: string;
  value: ShipDataRow | null;
  ships: ShipDataRow[];
  ownedNames: Set<string>;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  // Sépare en « Mes vaisseaux » (possédés, matching par nom) / « Catalogue » (façon V1).
  const owned = ships.filter((s) => ownedNames.has(s.name.toLowerCase()));
  const others = ships.filter((s) => !ownedNames.has(s.name.toLowerCase()));
  const opt = (s: ShipDataRow): DropdownOption => ({
    value: String(s.id),
    label: `${s.name} — ${s.manufacturer}`,
  });
  const groups: DropdownGroup[] =
    owned.length > 0
      ? [
          { label: t("comparator.myShips"), options: owned.map(opt) },
          { label: t("comparator.catalog"), options: others.map(opt) },
        ]
      : [{ options: others.map(opt) }];

  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <Dropdown
        value={value ? String(value.id) : ""}
        onChange={onChange}
        placeholder={t("comparator.selectShipOption")}
        searchable
        searchPlaceholder={t("common.searchPlaceholder")}
        buttonClassName="rounded-xl px-3 py-2.5"
        groups={groups}
        ariaLabel={label}
      />
    </label>
  );
}

// Vignette top-down d'un vaisseau dans le Comparateur (seule image de la colonne, ratio ~2.5:1).
function ShipTopDown({ name, accent }: { name: string; accent: string }) {
  const { t } = useTranslation();
  const url = resolveShipTopDownUrl(name, "s");
  const [src, setSrc] = useState<string | null>(url);
  useEffect(() => {
    setSrc(url);
  }, [url]);
  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30"
      style={{ aspectRatio: "2.5 / 1" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at center, ${accent}22 0%, transparent 70%)`,
        }}
        aria-hidden
      />
      {src ? (
        <img
          src={src}
          alt={t("comparator.topDownAlt", { name })}
          onError={() => setSrc(null)}
          className="relative z-10 max-h-[88%] max-w-[92%] object-contain"
        />
      ) : (
        <Rocket className="relative z-10 h-7 w-7" style={{ color: accent, opacity: 0.25 }} />
      )}
    </div>
  );
}
