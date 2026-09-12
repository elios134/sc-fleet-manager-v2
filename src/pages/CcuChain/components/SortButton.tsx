import { type ReactNode } from "react";

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.1)",
        color: active ? "var(--accent)" : "rgba(255,255,255,0.5)",
      }}
    >
      {children}
    </button>
  );
}

export { SortButton };
