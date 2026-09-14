import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Store, ShoppingCart } from "lucide-react";
import { useCart } from "../lib/useCart";
import CartPanel from "../components/catalogue/CartPanel";
import LocationsTab from "../components/catalogue/LocationsTab";
import { fmt } from "../components/catalogue/shared";

// Catalogue = Universal Item Finder par LIEU : on part d'un terminal/station et on voit
// tout ce qu'on peut y acheter (prix + fraîcheur), clic → modale de détail. Le panier
// (partagé) agrège les items et calcule une route d'achat optimisée (CartPanel).
export default function CataloguePage() {
  const { t } = useTranslation();
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const cartTotal = cart.items.reduce((s, it) => s + (it.price ?? 0), 0);

  return (
    <div className="p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <header>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("catalogue.eyebrow")}</p>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Store className="h-6 w-6 text-[var(--accent)]" /> {t("catalogue.title")}
          </h1>
        </header>

        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10"
        >
          <ShoppingCart className="h-4 w-4 text-[var(--accent)]" />
          {t("cart.title")}
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold text-white">
            {cart.items.length}
          </span>
          {cart.items.length > 0 && cartTotal > 0 && (
            <span className="text-white/60">
              · <b className="font-semibold text-white">{fmt(cartTotal)}</b>{" "}
              <span className="text-[11px] text-white/45">{t("catalogue.aUEC")}</span>
            </span>
          )}
        </button>
      </div>

      <LocationsTab />

      {cartOpen && (
        <CartPanel items={cart.items} onRemove={cart.remove} onClear={cart.clear} onClose={() => setCartOpen(false)} />
      )}
    </div>
  );
}
