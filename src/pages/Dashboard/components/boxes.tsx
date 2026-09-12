import { type TFunction } from "i18next";
import { type WidgetDef } from "../types";

/* Wrapper cliquable : navigue au clic hors mode édition (en édition, priorité au drag). */
function ClickableBody({
  editing,
  onClick,
  children,
}: {
  editing: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div onClick={editing ? undefined : onClick} className={editing ? undefined : "cursor-pointer"}>
      {children}
    </div>
  );
}

/* ── Boîtes génériques ── */

function PendingBox({ def, t }: { def: WidgetDef; t: TFunction }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-white/30 ${
        def.span === 2 ? "min-h-[120px]" : "min-h-[72px]"
      }`}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: def.tint, color: def.accent }}
      >
        <def.Icon className="h-4 w-4" />
      </div>
      <span className="text-xs">{t("dashboard.pending")}</span>
    </div>
  );
}

function NeutralBox({ def, span }: { def: WidgetDef; span: 1 | 2 }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-dashed border-white/10 text-2xl font-bold text-white/30 ${
        span === 2 ? "min-h-[120px]" : "min-h-[72px]"
      }`}
    >
      <span className="sr-only">{def.key}</span>—
    </div>
  );
}

export { ClickableBody, PendingBox, NeutralBox };
