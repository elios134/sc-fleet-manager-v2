import { useTranslation } from "react-i18next";

/** Bouton « Afficher N de plus » sous une liste affichée par paquets (rien s'il ne reste rien). */
export function ShowMore({ rest, step, onMore }: { rest: number; step: number; onMore: () => void }) {
  const { t } = useTranslation();
  if (rest <= 0) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      className="mx-auto my-3 block rounded-full border border-white/12 bg-white/5 px-4 py-1.5 text-[12px] text-white/65 hover:bg-white/10"
    >
      {t("catalogue.showMore", { n: Math.min(rest, step) })}
    </button>
  );
}
