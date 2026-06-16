import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/* Coquille de modale unifiée (DA V2) : overlay sombre, panneau verre rounded-2xl,
 * bordure accent, en-tête optionnel (titre + ✕), fermeture par clic dehors / Échap.
 * Le CONTENU est passé en children (corps scrollable). `footer` optionnel.
 * `size` règle la largeur ; `bodyClassName` pour ajuster le padding interne. */
export default function Modal({
  onClose,
  title,
  children,
  footer,
  size = "md",
  bodyClassName = "p-5",
  panelClassName = "",
}: {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  bodyClassName?: string;
  panelClassName?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const width =
    size === "sm" ? "max-w-md" : size === "lg" ? "max-w-2xl" : size === "xl" ? "max-w-4xl" : "max-w-xl";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 flex max-h-[85vh] w-full ${width} flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl ${panelClassName}`}
        style={{
          background: "rgba(16,18,24,0.95)",
          borderColor: "color-mix(in oklab, var(--accent) 20%, transparent)",
        }}
      >
        {title != null && (
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer != null && <div className="shrink-0 border-t border-white/10 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
