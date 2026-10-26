import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeftRight, Loader2, Package, Wrench } from "lucide-react";
import type { ShipRow } from "../../pages/Fleet";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../../lib/starjump";

/* ── Types ── */

type PledgeOrigin = {
  pledgeId: number;
  pledgeName: string;
  pledgeType: string;
  createdDate: string | null;
  isUpgraded: number;
  shipsCount: number;
};

// Clés i18n des types de pledge issus du scrape (cf. rsi_scrape.rs pledge_type).
const PLEDGE_TYPE_LABEL_KEYS: Record<string, string> = {
  game_package: "shipDetails.pledgeType.gamePackage",
  standalone_ship: "shipDetails.pledgeType.standaloneShip",
  cosmetic: "shipDetails.pledgeType.cosmetic",
};

function pledgeTypeLabel(type: string, t: TFunction): string {
  const key = PLEDGE_TYPE_LABEL_KEYS[type];
  return key ? t(key) : type;
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

/** Fiche d'un vaisseau de la flotte : image, taxonomie, specs, assurance, pack d'origine et
 *  actions (comparer, loadout, pack), plus d'éventuelles actions propres à la page appelante.
 *  `onLeave` est appelé avant de naviguer ailleurs (fermer la modale). */
export function ShipDetailsBody({
  ship,
  onLeave,
  extraActions,
}: {
  ship: ShipRow;
  onLeave?: () => void;
  extraActions?: ReactNode;
}) {
  const { t } = useTranslation();
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
    [t("shipDetails.specCrew"), formatCrew(ship.crewMin, ship.crewMax)],
    [t("shipDetails.specCargo"), ship.cargoScu != null ? `${ship.cargoScu.toLocaleString("fr-FR")} SCU` : "—"],
    [t("shipDetails.specMass"), formatMass(ship.mass)],
    [t("shipDetails.specDimensions"), dimensions ?? "—"],
    [t("shipDetails.specSize"), ship.shipDataSize ?? "—"],
    [t("shipDetails.specScmSpeed"), num(ship.scmSpeed, " m/s")],
    [t("shipDetails.specMaxSpeed"), num(ship.maxSpeed, " m/s")],
    [t("shipDetails.specShields"), num(ship.shieldHp, " HP")],
    [t("shipDetails.specHull"), num(ship.hullHp, " HP")],
    [t("shipDetails.specDps"), num(ship.baseDps)],
    [t("shipDetails.specEmSignature"), num(ship.emSignature)],
    [t("shipDetails.specIrSignature"), num(ship.irSignature)],
  ];
  // N'affiche la section que si au moins une spec est connue (vaisseau matché à ShipData).
  const hasSpecs = specs.some(([, v]) => v !== "—");

  const isPack = (origin?.shipsCount ?? 0) > 1;

  function openCompare() {
    onLeave?.();
    navigate("/ships/comparateur", { state: { preselectShipName: ship.name } });
  }
  function openLoadout() {
    onLeave?.();
    navigate("/ships/configurateur", { state: { preselectShipId: ship.id } });
  }
  function openPack() {
    if (!origin) return;
    onLeave?.();
    navigate(`/pack/${origin.pledgeId}`);
  }

  const insuranceType = isLti
    ? t("shipDetails.insuranceLti")
    : ship.insuranceDuration != null
      ? t("shipDetails.insuranceMonths", { n: ship.insuranceDuration })
      : t("shipDetails.insuranceStandard");
  const insuranceExpiry = isLti ? t("shipDetails.expiryLifetime") : (ship.insuranceExpiry ?? "—");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* En-tête */}
      <header className="px-6 pt-6">
        {isPack && origin && <p className="mb-1 text-xs uppercase tracking-wider text-white/40">{origin.pledgeName} ›</p>}
        <h2 className="text-2xl font-bold text-white">{ship.name}</h2>
        <p className="mt-0.5 text-sm text-white/50">{manufacturer}</p>
      </header>

      {/* Image vue de dessus (top-down Starjump), affichée en grand, non rognée */}
      <div className="mt-4 flex items-center justify-center rounded-xl bg-white/5 p-4 mx-6 h-72">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={ship.name}
            className="h-full w-full object-contain"
            onError={() => setImgSrc((cur) => (cur !== ship.imageUrl && ship.imageUrl ? ship.imageUrl : null))}
          />
        ) : (
          <span className="text-sm text-white/30">{t("common.noImage")}</span>
        )}
      </div>

      {/* Badges de taxonomie (dédupliqués) */}
      <div className="flex flex-wrap items-center gap-2 pt-4 px-6">
        {taxonomyBadges.map((b) => (
          <Badge key={b}>{b}</Badge>
        ))}
        {isLti && <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">LTI</span>}
      </div>

      {/* Spécifications techniques (ShipData) */}
      {hasSpecs && (
        <section className="pt-5 px-6">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("shipDetails.specifications")}</p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
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
      <section className="pt-5 px-6">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("shipDetails.insurance")}</p>
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-white/80">{insuranceType}</span>
          <span className="text-sm text-white/50">{t("shipDetails.insuranceExpiry", { value: insuranceExpiry })}</span>
        </div>
      </section>

      {/* Origine pledge */}
      <section className="pb-5 pt-5 px-6">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("shipDetails.originPledge")}</p>
        {loadingOrigin ? (
          <div className="flex items-center gap-2 text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loadingShort")}
          </div>
        ) : origin ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="font-medium text-white">{origin.pledgeName}</p>
            <p className="mt-0.5 text-sm text-white/50">
              {pledgeTypeLabel(origin.pledgeType, t)}
              {origin.createdDate ? ` · ${t("shipDetails.acquiredOn", { date: origin.createdDate })}` : ""}
              {origin.shipsCount > 1 ? ` · ${t("shipDetails.shipsIncluded", { n: origin.shipsCount })}` : ""}
              {origin.isUpgraded === 1 ? ` · ${t("shipDetails.upgradedCcu")}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-white/40">{t("shipDetails.noPledge")}</p>
        )}
      </section>

      {/* Actions */}
      <section className="flex flex-wrap gap-2 pb-6 px-6">
        {extraActions}
        <button
          onClick={openLoadout}
          className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/25"
        >
          <Wrench className="h-4 w-4" />
          {t("shipDetails.openLoadout")}
        </button>
        <button
          onClick={openCompare}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          <ArrowLeftRight className="h-4 w-4" />
          {t("shipDetails.compare")}
        </button>
        {isPack && (
          <button
            onClick={openPack}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            <Package className="h-4 w-4" />
            {t("shipDetails.viewPack")}
          </button>
        )}
      </section>
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
