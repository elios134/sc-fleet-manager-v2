import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Legend,
  ResponsiveContainer,
} from "recharts";

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
  dpsMax: number | null;
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

const RADAR_AXES: Array<{ key: keyof ShipDataRow; label: string }> = [
  { key: "radarSpeed", label: "Speed" },
  { key: "radarFirepower", label: "Firepower" },
  { key: "radarDefense", label: "Defense" },
  { key: "radarRange", label: "Range" },
  { key: "radarAgility", label: "Agility" },
  { key: "radarUtility", label: "Utility" },
];

function fmtNum(v: number | null, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function ComparatorPage() {
  const [ships, setShips] = useState<ShipDataRow[]>([]);
  const [shipA, setShipA] = useState<ShipDataRow | null>(null);
  const [shipB, setShipB] = useState<ShipDataRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    invoke<ShipDataRow[]>("get_all_ship_data")
      .then((data) => {
        if (!cancelled) setShips(data);
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
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Star Citizen</p>
        <h1 className="text-2xl font-bold text-white">COMPARATEUR</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des vaisseaux…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Erreur : {error}
        </p>
      ) : (
        <>
          {/* Recherche */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer les vaisseaux…"
            className="mb-4 w-full max-w-sm rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />

          {/* Pickers + swap */}
          <section className="mb-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <ShipSelect label="Vaisseau A" value={shipA} ships={filtered} onChange={(id) => pick(id, setShipA)} />
            <button
              onClick={swap}
              disabled={!shipA && !shipB}
              title="Inverser"
              className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40 sm:self-end"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <ShipSelect label="Vaisseau B" value={shipB} ships={filtered} onChange={(id) => pick(id, setShipB)} />
          </section>

          {!shipA && !shipB ? (
            <p className="text-sm text-white/40">Sélectionnez deux vaisseaux à comparer</p>
          ) : null}

          {shipA && shipB && (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Table comparative */}
                <div className="lg:col-span-2">
                  <ComparisonTable shipA={shipA} shipB={shipB} />
                </div>

                {/* Radar */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                    Radar tactique
                  </h2>
                  <ShipRadar shipA={shipA} shipB={shipB} />
                </div>
              </div>

              {/* Avantage stratégique */}
              <StrategicAdvantage shipA={shipA} shipB={shipB} />

              <button
                onClick={reset}
                className="mt-6 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                Réinitialiser
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
  onChange,
}: {
  label: string;
  value: ShipDataRow | null;
  ships: ShipDataRow[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <select
        value={value ? String(value.id) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-white/20 focus:outline-none"
      >
        <option value="" className="bg-[#14141c]">
          Sélectionner un vaisseau
        </option>
        {ships.map((s) => (
          <option key={s.id} value={s.id} className="bg-[#14141c]">
            {s.name} — {s.manufacturer}
          </option>
        ))}
      </select>
    </label>
  );
}

type CmpRow = {
  label: string;
  display: (s: ShipDataRow) => string;
  value: (s: ShipDataRow) => number | null;
};

const COMPARISON_ROWS: CmpRow[] = [
  { label: "Vitesse max", display: (s) => fmtNum(s.maxSpeed, " km/s"), value: (s) => s.maxSpeed },
  { label: "Vitesse SCM", display: (s) => fmtNum(s.scmSpeed, " m/s"), value: (s) => s.scmSpeed },
  { label: "Boucliers", display: (s) => fmtNum(s.shieldHp, " HP"), value: (s) => s.shieldHp },
  { label: "Coque", display: (s) => fmtNum(s.hullHp, " HP"), value: (s) => s.hullHp },
  { label: "DPS max", display: (s) => fmtNum(s.dpsMax), value: (s) => s.dpsMax },
  { label: "Cargo", display: (s) => fmtNum(s.cargoScu, " SCU"), value: (s) => s.cargoScu },
  { label: "Carburant quantique", display: (s) => fmtNum(s.quantumFuel), value: (s) => s.quantumFuel },
  {
    label: "Équipage min/max",
    display: (s) =>
      s.crewMin == null && s.crewMax == null ? "—" : `${s.crewMin ?? "?"}–${s.crewMax ?? "?"}`,
    value: () => null, // intervalle : pas de gagnant
  },
  { label: "Masse", display: (s) => fmtNum(s.mass, " kg"), value: (s) => s.mass },
  { label: "Prix aUEC", display: (s) => fmtNum(s.priceUec, " aUEC"), value: (s) => s.priceUec },
  { label: "Longueur", display: (s) => fmtNum(s.length, " m"), value: (s) => s.length },
  { label: "Largeur", display: (s) => fmtNum(s.beam, " m"), value: (s) => s.beam },
  { label: "Hauteur", display: (s) => fmtNum(s.height, " m"), value: (s) => s.height },
  { label: "Signature EM", display: (s) => fmtNum(s.emSignature), value: (s) => s.emSignature },
  { label: "Signature IR", display: (s) => fmtNum(s.irSignature), value: (s) => s.irSignature },
];

function ComparisonTable({ shipA, shipB }: { shipA: ShipDataRow; shipB: ShipDataRow }) {
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
          {COMPARISON_ROWS.map((row) => {
            const a = row.value(shipA);
            const b = row.value(shipB);
            const aWins = a != null && b != null && a > b;
            const bWins = a != null && b != null && b > a;
            return (
              <tr key={row.label} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2 text-white/50">{row.label}</td>
                <td className={["px-4 py-2", aWins ? "font-bold text-indigo-400" : "text-white/80"].join(" ")}>
                  {row.display(shipA)}
                </td>
                <td className={["px-4 py-2", bWins ? "font-bold text-indigo-400" : "text-white/80"].join(" ")}>
                  {row.display(shipB)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShipRadar({ shipA, shipB }: { shipA: ShipDataRow; shipB: ShipDataRow }) {
  const data = RADAR_AXES.map((ax) => ({
    axis: ax.label,
    A: shipA[ax.key] as number,
    B: shipB[ax.key] as number,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid stroke="rgba(255,255,255,0.15)" />
        <PolarAngleAxis dataKey="axis" tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }} />
        <Radar
          name={shipA.name}
          dataKey="A"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.3}
        />
        <Radar
          name={shipB.name}
          dataKey="B"
          stroke="#f59e0b"
          fill="#f59e0b"
          fillOpacity={0.3}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "white" }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function StrategicAdvantage({ shipA, shipB }: { shipA: ShipDataRow; shipB: ShipDataRow }) {
  let bestA = { label: "", delta: -Infinity };
  let bestB = { label: "", delta: -Infinity };
  for (const ax of RADAR_AXES) {
    const va = shipA[ax.key] as number;
    const vb = shipB[ax.key] as number;
    if (va - vb > bestA.delta) bestA = { label: ax.label, delta: va - vb };
    if (vb - va > bestB.delta) bestB = { label: ax.label, delta: vb - va };
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm">
        <span className="text-white/50">Avantage {shipA.name} : </span>
        <span className="font-semibold text-indigo-300">
          {bestA.delta > 0 ? bestA.label : "—"}
        </span>
      </div>
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
        <span className="text-white/50">Avantage {shipB.name} : </span>
        <span className="font-semibold text-amber-300">
          {bestB.delta > 0 ? bestB.label : "—"}
        </span>
      </div>
    </div>
  );
}
