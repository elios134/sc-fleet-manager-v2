// Pastille de synchro en cours dans la barre du haut (premier lancement, synchro auto).
import { Loader2 } from "lucide-react";

export function SyncPill({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 cursor-pointer items-center gap-2 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{
        color: "var(--warning)",
        borderColor: "color-mix(in oklab, var(--warning) 40%, rgba(255,255,255,0.1))",
        background: "color-mix(in oklab, var(--warning) 12%, transparent)",
      }}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </button>
  );
}
