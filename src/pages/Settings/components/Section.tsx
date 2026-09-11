import type { ReactNode } from "react";

// Encart titré des réglages (chrome commun à toutes les sections de la page).
export function Section({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "rounded-2xl border border-white/10 bg-white/[0.025] p-5 backdrop-blur-sm",
        className ?? "",
      ].join(" ")}
    >
      <div className="mb-4 border-b border-white/10 pb-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-white/50">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
