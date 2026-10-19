/** Sélecteur en segments (une option active, fond d'accent). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3.5 py-1 text-[12.5px] font-semibold ${o.value === value ? "bg-[var(--accent)] text-white" : "text-white/55 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
