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
