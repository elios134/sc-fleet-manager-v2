import type { ReactNode } from "react";

/* Mise en page « liste + fiche fixe » (Catalogue, Cosmétiques, Flotte, CCU, Minage) : contenu
   principal à gauche, fiche collante à droite, large (440 px, 520 px sur grand écran) avec
   défilement interne. Sous 1024 px, la fiche passe sous la liste. */
export function SidePanelLayout({ children, panel }: { children: ReactNode; panel: ReactNode | null }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="min-w-0">{children}</div>
      {panel && <aside className="glass flex max-h-[calc(100vh-7rem)] flex-col rounded-2xl p-4 lg:sticky lg:top-4">{panel}</aside>}
    </div>
  );
}
