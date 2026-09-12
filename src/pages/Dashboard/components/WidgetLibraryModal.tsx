import { useEffect, useRef, useState } from "react";
import { type TFunction } from "i18next";
import { Check, X } from "lucide-react";
import { type Placed } from "../types";
import { WIDGETS, WIDGET_ORDER } from "../widgets";

/* ─────────────── Bibliothèque de widgets (modale glassmorphique déplaçable) ─── */

function WidgetLibraryModal({
  open,
  placed,
  t,
  onAdd,
  onRemove,
  onClose,
}: {
  open: boolean;
  placed: Placed[];
  t: TFunction;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // null = position centrée par défaut ; sinon coordonnées fixes (après déplacement).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Recentre à chaque réouverture.
  useEffect(() => {
    if (open) setPos(null);
  }, [open]);

  if (!open) return null;

  // Déplacement libre via l'en-tête, borné à la fenêtre (jamais hors écran → pas de scroll).
  function startDrag(e: React.PointerEvent) {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const { left: originX, top: originY, width: w, height: h } = rect;
    setPos({ x: originX, y: originY });
    const move = (ev: PointerEvent) => {
      const nx = Math.min(Math.max(0, originX + ev.clientX - startX), window.innerWidth - w);
      const ny = Math.min(Math.max(0, originY + ev.clientY - startY), window.innerHeight - h);
      setPos({ x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const placement: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: "50%", top: 96, transform: "translateX(-50%)" };

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", zIndex: 50, ...placement }}
      className="w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-white/15 bg-[#14101f]/80 shadow-2xl backdrop-blur-2xl"
    >
      {/* En-tête = poignée de déplacement */}
      <div
        onPointerDown={startDrag}
        className="flex cursor-move touch-none select-none items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-3"
      >
        <h3 className="text-sm font-semibold tracking-wide text-white">
          {t("dashboard.widgetLibrary")}
        </h3>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={t("dashboard.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Grille des widgets disponibles : icône + nom + description, sans scroll */}
      <div className="grid grid-cols-3 gap-2.5 p-4">
        {WIDGET_ORDER.map((key) => {
          const def = WIDGETS[key];
          const added = placed.some((p) => p.key === key);
          return (
            <button
              key={key}
              onClick={() => (added ? onRemove(key) : onAdd(key))}
              title={added ? t("dashboard.removeWidget") : t("dashboard.addWidget")}
              className={`group flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                added
                  ? "border-[#2ee9a5]/30 bg-[#2ee9a5]/[0.06] hover:border-red-400/40 hover:bg-red-400/[0.08]"
                  : "border-white/10 bg-white/5 hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: def.tint, color: def.accent }}
                >
                  <def.Icon className="h-4 w-4" />
                </div>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                  {t(def.nameKey)}
                </span>
                {added && (
                  <>
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#2ee9a5] group-hover:hidden" />
                    <X className="hidden h-3.5 w-3.5 shrink-0 text-red-400 group-hover:block" />
                  </>
                )}
              </div>
              <span className="text-[11px] leading-snug text-white/45">{t(def.descKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { WidgetLibraryModal };
