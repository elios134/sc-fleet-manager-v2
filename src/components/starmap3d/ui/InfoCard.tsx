import { safeName, type StarmapBodyItem, type GeoBody } from "../starmapData";

type Fact = { k: string; v: string };

function facts(body: StarmapBodyItem, geoBody: GeoBody | null): Fact[] {
  const out: Fact[] = [{ k: "SYSTÈME", v: body.systemName }];
  out.push({ k: "TYPE", v: body.navIcon });
  if (body.subtype) out.push({ k: "SOUS-TYPE", v: body.subtype });
  if (body.habitable === 1) out.push({ k: "HABITABLE", v: "Oui" });
  if (geoBody && geoBody.bodyRadius > 0) out.push({ k: "RAYON", v: `${Math.round(geoBody.bodyRadius).toLocaleString("fr-FR")} km` });
  if (body.distance != null) out.push({ k: "DISTANCE", v: `${Math.round(body.distance).toLocaleString("fr-FR")} Gm` });
  return out;
}

/** Fiche détaillée : en-tête, grille de faits, description. Tokens theme.css. */
export function InfoCard({
  body,
  geoBody,
  onClose,
}: {
  body: StarmapBodyItem;
  geoBody: GeoBody | null;
  onClose: () => void;
}) {
  const rows = facts(body, geoBody);
  return (
    <div className="absolute bottom-3 left-3 z-10 flex max-h-[60%] w-72 flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0f]/90 backdrop-blur">
      <div className="flex items-start gap-2 border-b border-white/10 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-white">{safeName(body)}</div>
          <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-white/40">
            {body.navIcon}
            {body.subtype ? ` · ${body.subtype}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="shrink-0 rounded border border-white/10 px-1.5 text-white/60 transition-colors hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-1.5">
          {rows.map((f) => (
            <div key={f.k} className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
              <span className="block truncate font-mono text-[7.5px] font-bold tracking-[0.1em] text-white/40">{f.k}</span>
              <span className="mt-1 block truncate font-mono text-[11px] font-semibold tabular-nums text-white">{f.v}</span>
            </div>
          ))}
        </div>
        {body.description && (
          <p className="mt-3 text-xs leading-relaxed text-white/60">{body.description}</p>
        )}
      </div>
    </div>
  );
}
