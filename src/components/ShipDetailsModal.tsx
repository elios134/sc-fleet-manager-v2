import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, Loader2, Package, Wrench, X } from "lucide-react";
import type { ShipRow } from "../pages/FleetPage";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../lib/starjump";

/* ── Types ── */

type PledgeOrigin = {
  pledgeId: number;
  pledgeName: string;
  pledgeType: string;
  createdDate: string | null;
  isUpgraded: number;
  shipsCount: number;
};

// Libellés FR des types de pledge issus du scrape (cf. rsi_scrape.rs pledge_type).
const PLEDGE_TYPE_LABELS: Record<string, string> = {
  game_package: "Pack de jeu",
  standalone_ship: "Achat individuel",
  cosmetic: "Cosmétique",
};

function pledgeTypeLabel(type: string): string {
  return PLEDGE_TYPE_LABELS[type] ?? type;
}

/* ── Helpers de formatage des specs (portés de V1 buildShipDetailsData) ── */

function formatCrew(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min == null) return `${max}`;
  if (max == null || min === max) return `${min}`;
  return `${min}–${max}`;
}

function formatMass(massKg: number | null): string {
  if (massKg == null) return "—";
  if (massKg < 1000) return `${Math.round(massKg)} kg`;
  const tonnes = massKg / 1000;
  if (massKg < 100_000) return tonnes.toFixed(1).replace(".", ",") + " t";
  return Math.round(tonnes).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " t";
}

function buildDimensions(
  length: number | null,
  beam: number | null,
  height: number | null,
): string | null {
  const values = [length, beam, height]
    .filter((v): v is number => v != null)
    .map((v) => Math.round(v));
  if (values.length === 0) return null;
  return values.join(" × ") + " m";
}

function num(v: number | null, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function ShipDetailsModal({
  ship,
  onClose,
}: {
  ship: ShipRow;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<PledgeOrigin | null>(null);
  const [loadingOrigin, setLoadingOrigin] = useState(true);

  // Image = vue de dessus (top-down Starjump), repli image RSI puis placeholder — comme le
  // ShipBanner du Loadout. Le manifeste est rafraîchi au montage (best-effort).
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  useEffect(() => {
    void refreshStarjumpManifest();
  }, []);
  useEffect(() => {
    setImgSrc(resolveShipTopDownUrl(ship.name) ?? ship.imageUrl ?? null);
  }, [ship.name, ship.imageUrl]);

  useEffect(() => {
    let cancelled = false;
    setLoadingOrigin(true);
    invoke<PledgeOrigin | null>("get_ship_pledge_origin", { shipId: ship.id })
      .then((o) => {
        if (!cancelled) setOrigin(o);
      })
      .catch(() => {
        if (!cancelled) setOrigin(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingOrigin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ship.id]);

  const manufacturer = ship.shipDataManufacturer ?? ship.manufacturer;
  const role = ship.shipDataRole ?? ship.role;
  const classification = ship.shipDataClassification;
  const focus = ship.shipDataFocus;
  const isLti = ship.lti === 1;

  // Badges de taxonomie dédupliqués : role + sous-catégories DISTINCTES. classification peut
  // contenir une chaîne (« Starter / Light Fighter ») et focus reprend souvent la queue de
  // classification → on éclate sur « / » et on retire les répétitions (insensible à la casse).
  const taxonomyBadges: string[] = [];
  {
    const seen = new Set<string>();
    const add = (v: string | null | undefined) => {
      if (!v) return;
      for (const part of v.split("/").map((t) => t.trim()).filter(Boolean)) {
        const key = part.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          taxonomyBadges.push(part);
        }
      }
    };
    add(role);
    add(classification);
    add(focus);
  }

  // Specs (issues de ShipData via le LEFT JOIN de get_ships).
  const dimensions = buildDimensions(ship.length, ship.beam, ship.height);
  const specs: Array<[string, string]> = [
    ["Équipage", formatCrew(ship.crewMin, ship.crewMax)],
    ["Cargo", ship.cargoScu != null ? `${ship.cargoScu.toLocaleString("fr-FR")} SCU` : "—"],
    ["Masse", formatMass(ship.mass)],
    ["Dimensions", dimensions ?? "—"],
    ["Taille", ship.shipDataSize ?? "—"],
    ["Vitesse SCM", num(ship.scmSpeed, " m/s")],
    ["Vitesse max", num(ship.maxSpeed, " m/s")],
    ["Boucliers", num(ship.shieldHp, " HP")],
    ["Coque", num(ship.hullHp, " HP")],
    ["DPS (armes par défaut)", num(ship.baseDps)],
    ["Signature EM", num(ship.emSignature)],
    ["Signature IR", num(ship.irSignature)],
  ];
  // N'affiche la section que si au moins une spec est connue (vaisseau matché à ShipData).
  const hasSpecs = specs.some(([, v]) => v !== "—");

  const isPack = (origin?.shipsCount ?? 0) > 1;

  function openCompare() {
    onClose();
    navigate("/comparator", { state: { preselectShipName: ship.name } });
  }
  function openLoadout() {
    onClose();
    navigate("/loadout", { state: { preselectShipId: ship.id } });
  }
  function openPack() {
    if (!origin) return;
    onClose();
    navigate(`/pack/${origin.pledgeId}`);
  }

  const insuranceType = isLti
    ? "Assurance à vie (LTI)"
    : ship.insuranceDuration != null
      ? `Assurance ${ship.insuranceDuration} mois`
      : "Assurance standard";
  const insuranceExpiry = isLti ? "À vie" : (ship.insuranceExpiry ?? "—");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <header className="px-6 pt-6">
          {isPack && origin && (
            <p className="mb-1 text-xs uppercase tracking-wider text-white/40">
              {origin.pledgeName} ›
            </p>
          )}
          <h2 className="text-2xl font-bold text-white">{ship.name}</h2>
          <p className="mt-0.5 text-sm text-white/50">{manufacturer}</p>
        </header>

        {/* Image vue de dessus (top-down Starjump), affichée en grand, non rognée */}
        <div className="mx-6 mt-4 flex h-72 items-center justify-center rounded-xl bg-white/5 p-4">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={ship.name}
              className="h-full w-full object-contain"
              onError={() =>
                setImgSrc((cur) =>
                  cur !== ship.imageUrl && ship.imageUrl ? ship.imageUrl : null,
                )
              }
            />
          ) : (
            <span className="text-sm text-white/30">Pas d'image</span>
          )}
        </div>

        {/* Taxonomy badges (dédupliqués) */}
        <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
          {taxonomyBadges.map((b) => (
            <Badge key={b}>{b}</Badge>
          ))}
          {isLti && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
              LTI
            </span>
          )}
        </div>

        {/* Spécifications techniques (ShipData) */}
        {hasSpecs && (
          <section className="px-6 pt-5">
            <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Spécifications</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {specs.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
                  <p className="mt-0.5 truncate text-sm font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Assurance */}
        <section className="px-6 pt-5">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Assurance</p>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="text-sm text-white/80">{insuranceType}</span>
            <span className="text-sm text-white/50">Expiration : {insuranceExpiry}</span>
          </div>
        </section>

        {/* Origine pledge */}
        <section className="px-6 pb-6 pt-5">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Pledge d'origine</p>
          {loadingOrigin ? (
            <div className="flex items-center gap-2 text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : origin ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="font-medium text-white">{origin.pledgeName}</p>
              <p className="mt-0.5 text-sm text-white/50">
                {pledgeTypeLabel(origin.pledgeType)}
                {origin.createdDate ? ` · acquis le ${origin.createdDate}` : ""}
                {origin.shipsCount > 1 ? ` · ${origin.shipsCount} vaisseaux inclus` : ""}
                {origin.isUpgraded === 1 ? " · upgradé (CCU)" : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/40">Aucun pledge rattaché (ajout manuel).</p>
          )}
        </section>

        {/* Actions */}
        <section className="flex flex-wrap gap-3 px-6 pb-6">
          <button
            onClick={openCompare}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Comparer
          </button>
          <button
            onClick={openLoadout}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/25"
          >
            <Wrench className="h-4 w-4" />
            Ouvrir le configurateur
          </button>
          {isPack && (
            <button
              onClick={openPack}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
            >
              <Package className="h-4 w-4" />
              Voir le pack
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/70">
      {children}
    </span>
  );
}
