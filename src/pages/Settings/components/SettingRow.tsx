import type { ReactNode } from "react";

/** Ligne de réglage : titre + description à gauche, contrôle à droite ; filet entre deux lignes. */
export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-white/[0.09] py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-white">{title}</p>
        {description && <p className="mt-0.5 text-xs text-white/50">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Carte en verre d'un panneau de réglages, titre + action optionnelle. */
export function SettingsCard({ title, hint, action, children }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass flex min-w-0 flex-col gap-3.5 rounded-2xl px-5 py-[18px]">
      {title && (
        <h2 className="flex flex-wrap items-center gap-2.5 text-[15px] font-bold text-white">
          {title}
          {hint && <small className="text-xs font-medium text-white/50">{hint}</small>}
          {action && <span className="ml-auto">{action}</span>}
        </h2>
      )}
      {children}
    </section>
  );
}
