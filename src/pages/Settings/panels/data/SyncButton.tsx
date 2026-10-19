import type { ReactNode } from "react";

/** Bouton de synchro individuelle : roue pendant la synchro, libellé « en cours » fourni. */
export function SyncButton({ busy, disabled, onClick, children }: { busy: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
      {children}
    </button>
  );
}

/** Résultat vert d'une synchro (une ligne de récap). */
export function SyncResult({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">{children}</div>;
}
