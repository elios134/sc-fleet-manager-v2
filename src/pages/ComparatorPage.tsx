import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Loader2, Rocket } from "lucide-react";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../lib/starjump";
import Dropdown, { type DropdownOption, type DropdownGroup } from "../components/ui/Dropdown";

interface ShipDataRow {
  id: number;
  name: string;
  manufacturer: string;
  role: string;
  classification: string;
  focus: string;
  size: string | null;
  length: number | null;
  beam: number | null;
  height: number | null;
  maxSpeed: number | null;
  scmSpeed: number | null;
  shieldHp: number | null;
  hullHp: number | null;
  baseDps: number | null;
  cargoScu: number | null;
  quantumFuel: number | null;
  crewMin: number | null;
  crewMax: number | null;
  mass: number | null;
  priceUec: number | null;
  imageUrl: string | null;
  radarSpeed: number;
  radarFirepower: number;
  radarDefense: number;
  radarRange: number;
  radarAgility: number;
  radarUtility: number;
  emSignature: number | null;
  irSignature: number | null;
  crossSection: number | null;
}

const RADAR_AXES: Array<{ key: keyof ShipDataRow; labelKey: string }> = [
  { key: "radarSpeed", labelKey: "comparator.radar.speed" },
  { key: "radarFirepower", labelKey: "comparator.radar.firepower" },
  { key: "radarDefense", labelKey: "comparator.radar.defense" },
  { key: "radarRange", labelKey: "comparator.radar.range" },
  { key: "radarAgility", labelKey: "comparator.radar.agility" },
  { key: "radarUtility", labelKey: "comparator.radar.utility" },
];

function fmtNum(v: number | null, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function ComparatorPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipDataRow[]>([]);
  const [shipA, setShipA] = usePersistentState<ShipDataRow | null>("comparator.shipA", null);
  const [shipB, setShipB] = usePersistentState<ShipDataRow | null>("comparator.shipB", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePersistentState("comparator.search", "");
  const [ownedNames, setOwnedNames] = useState<Set<string>>(new Set());
  const location = useLocation();

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
        if (!cancelled) setShips(data);
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

  function pick(id: string, setter: (s: ShipDataRow | null) => void) {
    setter(ships.find((s) => String(s.id) === id) ?? null);
  }

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("comparator.subtitlePrefix")}</p>
        <h1 className="text-2xl font-bold text-white">{t("comparator.title")}</h1>
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
              {/* Vignette top-down par colonne (seule image, sous les selects) */}
              <div className="mb-6 grid grid-cols-2 gap-4">
                <ShipTopDown name={shipA.name} accent="#6366f1" />
                <ShipTopDown name={shipB.name} accent="#f59e0b" />
              </div>

              {/* Table comparative pleine largeur */}
              <ComparisonTable shipA={shipA} shipB={shipB} />

              {/* Avantage stratégique */}
              <StrategicAdvantage shipA={shipA} shipB={shipB} />

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

type CmpRow = {
  labelKey: string;
  display: (s: ShipDataRow) => string;
};

const COMPARISON_ROWS: CmpRow[] = [
  { labelKey: "comparator.row.maxSpeed", display: (s) => fmtNum(s.maxSpeed, " km/s") },
  { labelKey: "comparator.row.scmSpeed", display: (s) => fmtNum(s.scmSpeed, " m/s") },
  { labelKey: "comparator.row.shields", display: (s) => fmtNum(s.shieldHp, " HP") },
  { labelKey: "comparator.row.hull", display: (s) => fmtNum(s.hullHp, " HP") },
  { labelKey: "comparator.row.dps", display: (s) => fmtNum(s.baseDps) },
  { labelKey: "comparator.row.cargo", display: (s) => fmtNum(s.cargoScu, " SCU") },
  { labelKey: "comparator.row.quantumFuel", display: (s) => fmtNum(s.quantumFuel) },
  {
    labelKey: "comparator.row.crew",
    display: (s) =>
      s.crewMin == null && s.crewMax == null ? "—" : `${s.crewMin ?? "?"}–${s.crewMax ?? "?"}`,
  },
  { labelKey: "comparator.row.mass", display: (s) => fmtNum(s.mass, " kg") },
  { labelKey: "comparator.row.priceUec", display: (s) => fmtNum(s.priceUec, " aUEC") },
  { labelKey: "comparator.row.length", display: (s) => fmtNum(s.length, " m") },
  { labelKey: "comparator.row.beam", display: (s) => fmtNum(s.beam, " m") },
  { labelKey: "comparator.row.height", display: (s) => fmtNum(s.height, " m") },
  { labelKey: "comparator.row.emSignature", display: (s) => fmtNum(s.emSignature) },
  { labelKey: "comparator.row.irSignature", display: (s) => fmtNum(s.irSignature) },
];

function ComparisonTable({ shipA, shipB }: { shipA: ShipDataRow; shipB: ShipDataRow }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-white/40">
            <th className="px-4 py-2 font-medium"></th>
            <th className="px-4 py-2 font-semibold text-white">{shipA.name}</th>
            <th className="px-4 py-2 font-semibold text-white">{shipB.name}</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.labelKey} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-2 text-white/50">{t(row.labelKey)}</td>
              <td className="px-4 py-2 text-white/80">{row.display(shipA)}</td>
              <td className="px-4 py-2 text-white/80">{row.display(shipB)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function StrategicAdvantage({ shipA, shipB }: { shipA: ShipDataRow; shipB: ShipDataRow }) {
  const { t } = useTranslation();
  let bestA = { labelKey: "", delta: -Infinity };
  let bestB = { labelKey: "", delta: -Infinity };
  for (const ax of RADAR_AXES) {
    const va = shipA[ax.key] as number;
    const vb = shipB[ax.key] as number;
    if (va - vb > bestA.delta) bestA = { labelKey: ax.labelKey, delta: va - vb };
    if (vb - va > bestB.delta) bestB = { labelKey: ax.labelKey, delta: vb - va };
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm">
        <span className="text-white/50">{t("comparator.advantage", { ship: shipA.name })}</span>
        <span className="font-semibold text-indigo-300">
          {bestA.delta > 0 ? t(bestA.labelKey) : "—"}
        </span>
      </div>
      <div className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm">
        <span className="text-white/50">{t("comparator.advantage", { ship: shipB.name })}</span>
        <span className="font-semibold text-accent">
          {bestB.delta > 0 ? t(bestB.labelKey) : "—"}
        </span>
      </div>
    </div>
  );
}
