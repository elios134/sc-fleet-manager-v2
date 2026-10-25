import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ItemDetailBody } from "./ItemDetailBody";
import type { ItemLite } from "./useItemDetail";

// Modale de détail d'un article (vue « Par lieu ») : la fiche partagée dans une fenêtre.
// `onImage` remonte l'image trouvée (Wiki) pour l'afficher ensuite dans la liste.
export function ItemDetailModal({ item, onClose, onImage }: { item: ItemLite; onClose: () => void; onImage?: (uuid: string, url: string) => void }) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/12 bg-[var(--background)] shadow-2xl">
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label={t("cart.close")}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-black/40 text-white/60 hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <ItemDetailBody key={item.uuid ?? item.idItem} item={item} onImage={onImage} />
      </div>
    </div>
  );
}
