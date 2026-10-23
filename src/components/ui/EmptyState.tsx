import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

type Action = { label: string; onClick: () => void; busy?: boolean; busyLabel?: string };

/** État vide commun : explique pourquoi il n'y a rien et propose l'action qui règle le
 *  problème (synchro, réglage…). Jamais d'écran blanc. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  secondary,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: Action;
  secondary?: Action;
  compact?: boolean;
}) {
  return (
    <div
      className={`grid place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.015] text-center ${compact ? "px-5 py-6" : "px-6 py-10"}`}
    >
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-muted)] text-indigo-200 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.4)]">
        <Icon className="h-6 w-6" />
      </span>
      <p className={`font-bold text-white ${compact ? "text-sm" : "text-base"}`}>{title}</p>
      <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] text-white/60">{text}</p>
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.busy}
              className="flex items-center gap-2 rounded-[10px] bg-[var(--accent)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {action.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {action.busy ? action.busyLabel ?? action.label : action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-white/10"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
