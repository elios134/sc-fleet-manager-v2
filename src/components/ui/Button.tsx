import type { ButtonHTMLAttributes, ReactNode } from "react";

/* Bouton unifié (DA V2). primary = plein var(--accent) ; secondary = outline verre. */
export default function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children?: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  const variantCls =
    variant === "primary"
      ? "bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90"
      : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10";
  return (
    <button className={`${base} ${variantCls} ${className}`} {...rest}>
      {children}
    </button>
  );
}
