// Formatage + construction de la heatmap pour le Carnet de bord.

/** Secondes → « 142 h » / « 45 min » / « 12 h ». */
export function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) return `${Math.round(h)} h`;
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

/** Heures décimales pour un libellé compact « 2 h 14 ». */
export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  return `${m} min`;
}

/** Nombre → « 1,24 M » / « 890 k » / « 340 » (aUEC). */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString("fr-FR")} k`;
  return `${Math.round(n)}`;
}

/** Date ISO → « aujourd'hui 21:47 » / « 14 févr. · 18:30 ». */
export function fmtSessionDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `aujourd'hui ${time}`;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${time}`;
}

export type HeatCell = { date: string; seconds: number; level: 0 | 1 | 2 | 3 | 4 };

/** Niveau 0–4 selon les heures (0 · <1h · <3h · <5h · ≥5h). */
function levelOf(seconds: number): HeatCell["level"] {
  const h = seconds / 3600;
  if (h <= 0) return 0;
  if (h < 1) return 1;
  if (h < 3) return 2;
  if (h < 5) return 3;
  return 4;
}

/**
 * Construit une grille de `weeks` semaines (colonnes) × 7 jours (dim→sam) se terminant
 * aujourd'hui, à partir des secondes/jour renvoyées par le backend. Chaque colonne = une
 * semaine ; l'ordre des cellules est chronologique par colonne.
 */
export function buildHeatmap(
  data: { date: string; seconds: number }[],
  weeks = 53,
): { cells: HeatCell[][]; monthLabels: (string | null)[]; peak: HeatCell | null } {
  const byDay = new Map(data.map((d) => [d.date, d.seconds]));
  const today = new Date();
  // Fin de grille = samedi de la semaine courante (colonne la plus à droite complète).
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));

  const cells: HeatCell[][] = [];
  const monthLabels: (string | null)[] = [];
  let peak: HeatCell | null = null;
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    let labelForCol: string | null = null;
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      const seconds = byDay.get(key) ?? 0;
      const cell: HeatCell = { date: key, seconds, level: levelOf(seconds) };
      if (d === 0 && cursor.getDate() <= 7) {
        labelForCol = cursor.toLocaleDateString("fr-FR", { month: "short" });
      }
      if (!peak || seconds > peak.seconds) peak = cell;
      col.push(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
    cells.push(col);
    monthLabels.push(labelForCol);
  }
  return { cells, monthLabels, peak: peak && peak.seconds > 0 ? peak : null };
}

/** Rend un code véhicule brut (« ORIG_m80 ») un peu plus lisible (« ORIG m80 »). */
export function prettyVehicle(name: string): string {
  return name.replace(/_/g, " ");
}
