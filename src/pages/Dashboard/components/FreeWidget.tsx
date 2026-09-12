import { useNavigate } from "react-router";
import { type TFunction } from "i18next";
import { X } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { type MissionListItem } from "../../missionShared";
import { type WidgetDef, type Placed, type DashData } from "../types";
import { widthOf } from "../helpers";
import { WidgetBody } from "./WidgetBody";

/* ─────────────────── Widget librement déplaçable ────────────────── */

function FreeWidget({
  item,
  def,
  editing,
  data,
  navigate,
  t,
  onOpenMission,
  onRemove,
}: {
  item: Placed;
  def: WidgetDef;
  editing: boolean;
  data: DashData | null;
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction;
  onOpenMission: (m: MissionListItem) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: def.key,
    disabled: !editing,
  });

  const style: React.CSSProperties = {
    position: "absolute",
    left: item.x,
    top: item.y,
    width: widthOf(def),
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editing ? { ...attributes, ...listeners } : {})}
      className={`rounded-2xl border bg-white/5 p-4 ${
        editing
          ? "cursor-grab border-dashed border-[var(--accent)]/40 active:cursor-grabbing"
          : "border-white/10"
      } ${isDragging ? "opacity-80 shadow-2xl" : ""}`}
    >
      {editing && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-[#d4537e] text-white shadow hover:brightness-110"
          aria-label={t("dashboard.removeWidget")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      <WidgetBody
        def={def}
        data={data}
        navigate={navigate}
        t={t}
        editing={editing}
        onOpenMission={onOpenMission}
      />
    </div>
  );
}

export { FreeWidget };
