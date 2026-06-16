import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";

/* Dropdown custom (DA V2) — remplace les <select> natifs dont le menu déroulant
 * n'est pas stylable sous Windows. Champ stylé + menu dark-glass à bordure accent,
 * options survolées en accent translucide, option courante marquée. Support des
 * GROUPES (en-têtes de section), recherche optionnelle, navigation clavier
 * (↑/↓, Entrée, Échap, Home/End), fermeture au clic extérieur. */

export type DropdownOption = { value: string; label: ReactNode; disabled?: boolean };
export type DropdownGroup = { label?: string; options: DropdownOption[] };

export default function Dropdown({
  value,
  onChange,
  options,
  groups,
  placeholder,
  searchable = false,
  searchPlaceholder,
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: DropdownOption[];
  groups?: DropdownGroup[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);

  // Normalise en groupes (liste plate = 1 groupe sans titre).
  const baseGroups: DropdownGroup[] = useMemo(
    () => groups ?? [{ options: options ?? [] }],
    [groups, options],
  );

  // Liste plate filtrée (recherche) + en-têtes, pour rendu + navigation clavier.
  const { rows, flat } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows: Array<{ type: "header"; label: string } | { type: "option"; opt: DropdownOption }> = [];
    const flat: DropdownOption[] = [];
    for (const g of baseGroups) {
      const opts = q
        ? g.options.filter((o) => labelText(o.label).toLowerCase().includes(q))
        : g.options;
      if (opts.length === 0) continue;
      if (g.label) rows.push({ type: "header", label: g.label });
      for (const o of opts) {
        rows.push({ type: "option", opt: o });
        flat.push(o);
      }
    }
    return { rows, flat };
  }, [baseGroups, search]);

  const selected = useMemo(() => {
    for (const g of baseGroups) {
      const f = g.options.find((o) => o.value === value);
      if (f) return f;
    }
    return null;
  }, [baseGroups, value]);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // À l'ouverture : surligne l'option courante, reset recherche.
  useEffect(() => {
    if (open) {
      setSearch("");
      const idx = flat.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recadre le surlignage quand la recherche réduit la liste.
  useEffect(() => {
    if (highlight >= flat.length) setHighlight(Math.max(0, flat.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat.length]);

  function commit(idx: number) {
    const o = flat[idx];
    if (o && !o.disabled) {
      onChange(o.value);
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => Math.min(flat.length - 1, h + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        break;
      case "Home":
        e.preventDefault();
        setHighlight(0);
        break;
      case "End":
        e.preventDefault();
        setHighlight(flat.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        commit(highlight);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left text-sm text-white transition-colors hover:bg-white/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-white/40"}`}>
          {selected ? selected.label : placeholder ?? ""}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/40" />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border bg-[#15161c] shadow-2xl ${menuClassName}`}
          style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}
          onKeyDown={onKeyDown}
        >
          {searchable && (
            <div className="border-b border-white/10 p-1.5">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder ?? ""}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {flat.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-white/30">—</div>
            ) : (
              (() => {
                let optIdx = -1;
                return rows.map((row, i) => {
                  if (row.type === "header") {
                    return (
                      <div
                        key={`h${i}`}
                        className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35"
                      >
                        {row.label}
                      </div>
                    );
                  }
                  optIdx += 1;
                  const idx = optIdx;
                  const isSel = row.opt.value === value;
                  const isHi = idx === highlight;
                  return (
                    <button
                      key={`o${i}`}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      disabled={row.opt.disabled}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => commit(idx)}
                      className={[
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-40",
                        isHi ? "bg-[var(--accent)]/15" : "",
                        isSel ? "text-[var(--accent)]" : "text-white/85",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.opt.label}</span>
                      {isSel && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
                    </button>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Extrait un texte cherchable d'un label (string ou nœud simple). */
function labelText(label: ReactNode): string {
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  return "";
}
