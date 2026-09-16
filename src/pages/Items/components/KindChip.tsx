import type { LucideIcon } from "lucide-react";

/* Filtre macro à icône + compteur (repris de la logique existante).
   Actif : teinté selon la catégorie ; inactif : neutre. */
export default function KindChip({
  active,
  onClick,
  label,
  count,
  Icon,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  Icon?: LucideIcon;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-white/25 bg-white/10 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      ].join(" ")}
      style={active && color ? { borderColor: `${color}80` } : undefined}
    >
      {Icon && <Icon className="h-4 w-4" style={active && color ? { color } : undefined} />}
      {label}
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
        style={
          active
            ? { background: "var(--accent)", color: "#fff" }
            : { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.60)" }
        }
      >
        {count}
      </span>
    </button>
  );
}
