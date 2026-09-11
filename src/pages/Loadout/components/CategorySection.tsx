import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type Variant } from "../types";
import { VARIANT_COLOR, VARIANT_BORDER } from "../helpers";

function CategorySection({
  title,
  icon: Icon,
  count,
  variant,
  collapsible,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  variant: Variant;
  collapsible: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = VARIANT_COLOR[variant];
  const borderColor = VARIANT_BORDER[variant];
  const isOpen = !collapsible || expanded;

  const header = (
    <>
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <span style={{ color }}>{title}</span>
      <span className="rounded-full bg-white/10 px-2 text-[10px] font-normal normal-case tracking-normal text-white/55">
        {count}
      </span>
      {collapsible && (
        <ChevronDown
          className="ml-auto h-4 w-4 transition-transform"
          style={{ color, opacity: 0.5, transform: expanded ? "rotate(180deg)" : "none" }}
        />
      )}
    </>
  );

  return (
    <div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mb-3 flex w-full items-center gap-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-75"
          style={{ borderBottomColor: borderColor }}
        >
          {header}
        </button>
      ) : (
        <div
          className="mb-3 flex items-center gap-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{ borderBottomColor: borderColor }}
        >
          {header}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="space-y-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Nom d'affichage d'un mount/tourelle/rack : nom du composant, suffixes " Mount" /
// " Gimbal Mount" retirés (ex. "VariPuck S3 Gimbal Mount" → "VariPuck S3"). Repli : portName.

export { CategorySection };
