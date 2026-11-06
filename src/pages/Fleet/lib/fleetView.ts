// Vue « bandeau + liste + fiche » de Ma flotte (logique pure, testée).
import type { ShipRow } from "../types";

/** État d'assurance d'un vaisseau, pour la pastille du tableau. Courte = moins de 12 mois. */
export type InsuranceTone = "lti" | "rental" | "short" | "unknown" | "ok";

export function insuranceTone(s: ShipRow): InsuranceTone {
  if (s.lti === 1) return "lti";
  if (s.acquisition === "rented") return "rental";
  if (s.insuranceDuration == null) return "unknown";
  return s.insuranceDuration < 12 ? "short" : "ok";
}

/** Chiffres du bandeau : nombre de vaisseaux, cargo total (SCU), équipage max cumulé,
 *  assurances courtes à surveiller (hors LTI et locations). */
export function fleetKpis(ships: ShipRow[]): { count: number; cargo: number; crew: number; shortInsurance: number } {
  return {
    count: ships.length,
    cargo: ships.reduce((a, s) => a + (s.cargoScu ?? 0), 0),
    crew: ships.reduce((a, s) => a + (s.crewMax ?? 0), 0),
    shortInsurance: ships.filter((s) => insuranceTone(s) === "short").length,
  };
}

/** Ligne du tableau : un vaisseau seul, ou un pack de plusieurs vaisseaux résumé en une ligne. */
export type FleetRow =
  | { kind: "ship"; ship: ShipRow }
  | { kind: "pack"; packId: number; name: string; shipCount: number; ltiCount: number; cargo: number; valueUsd: number | null; firstShip: ShipRow };

/** Lignes du tableau depuis la liste filtrée et triée : un pack apparaît une fois, à la place de son
 *  premier vaisseau visible, dès qu'un de ses vaisseaux passe le filtre. Ses totaux portent sur tout
 *  le pack (`all` = toute la flotte), pas seulement sur les vaisseaux visibles. */
export function fleetRows(visible: ShipRow[], all: ShipRow[]): FleetRow[] {
  const seen = new Set<number>();
  const rows: FleetRow[] = [];
  for (const s of visible) {
    if (s.packId == null) {
      rows.push({ kind: "ship", ship: s });
      continue;
    }
    if (seen.has(s.packId)) continue;
    seen.add(s.packId);
    const members = all.filter((m) => m.packId === s.packId);
    rows.push({
      kind: "pack",
      packId: s.packId,
      name: s.packName ?? s.name,
      shipCount: s.packShipCount ?? members.length,
      ltiCount: members.filter((m) => m.lti === 1).length,
      cargo: members.reduce((a, m) => a + (m.cargoScu ?? 0), 0),
      valueUsd: s.currentValueUsd,
      firstShip: members[0] ?? s,
    });
  }
  return rows;
}
