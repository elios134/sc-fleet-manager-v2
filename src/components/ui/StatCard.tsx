import type { ReactNode } from "react";

/* Carte de statistique unifiée (DA V2). Remplace les 3 implémentations divergentes
 * (Dashboard / Ma Flotte / Cargo / Missions). API rétro-compatible :
 *  - `value` (string) OU `children` (contenu libre, ex. Cargo).
 *  - `accent` (ou `variant="gold"`) → valeur en var(--accent), sinon blanc.
 *  - `caption` optionnelle. */
export default function StatCard({
  label,
  value,
  children,
  caption,
  accent,
  variant,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  caption?: string;
  accent?: boolean;
  variant?: "gold" | "neutral";
}) {
  const isAccent = accent || variant === "gold";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</p>
      {children != null ? (
        <div className="mt-1">{children}</div>
      ) : (
        <p
          className="mt-1 text-lg font-bold tabular-nums"
          style={{ color: isAccent ? "var(--accent)" : "#fff" }}
        >
          {value}
        </p>
      )}
      {caption && <p className="mt-0.5 text-[9px] uppercase tracking-wider text-white/30">{caption}</p>}
    </div>
  );
}
