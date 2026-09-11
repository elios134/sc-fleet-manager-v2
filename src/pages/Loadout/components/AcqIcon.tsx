import { type LucideIcon } from "lucide-react";

function AcqIcon({
  Icon,
  on,
  color,
  label,
  onShow,
}: {
  Icon: LucideIcon;
  on: boolean;
  color: string;
  label: string;
  onShow: () => void;
}) {
  if (!on) {
    return (
      <span title={label} className="flex h-7 w-7 items-center justify-center">
        <Icon className="h-[18px] w-[18px]" style={{ color: "rgba(255,255,255,0.16)" }} />
      </span>
    );
  }
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onShow();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/10"
    >
      <Icon className="h-[18px] w-[18px]" style={{ color }} />
    </button>
  );
}

export { AcqIcon };
