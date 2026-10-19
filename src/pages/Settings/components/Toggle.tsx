/** Interrupteur de réglage (bouton aria-pressed, pastille d'accent). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-[var(--accent)]" : "bg-white/15"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[19px]" : "left-[3px]"}`} />
    </button>
  );
}
