import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Store, ShoppingCart, PackageSearch, MapPin } from "lucide-react";
import { usePersistentState } from "../lib/uiPersist";
import { useCart } from "../lib/useCart";
import CartPanel from "../components/catalogue/CartPanel";
import LocationsTab from "../components/catalogue/LocationsTab";
import ItemsTab from "../components/catalogue/ItemsTab";
import { fmt } from "../components/catalogue/shared";

type FinderMode = "item" | "place";

// Catalogue = Universal Item Finder par LIEU : on part d'un terminal/station et on voit
// tout ce qu'on peut y acheter (prix + fraîcheur), clic → modale de détail. Le panier
// (partagé) agrège les items et calcule une route d'achat optimisée (CartPanel).
export default function CataloguePage() {
  const { t } = useTranslation();
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [mode, setMode] = usePersistentState<FinderMode>("catalogue.finderMode", "item");
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

      {/* Sélecteur de mode de recherche : Par article (item → tous les lieux) ou Par lieu. */}
      <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 p-1">
        {([
          { key: "item" as const, labelKey: "catalogue.tabItems", icon: PackageSearch },
          { key: "place" as const, labelKey: "catalogue.tabLocations", icon: MapPin },
        ]).map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                active ? "bg-[var(--accent)] text-white" : "text-white/55 hover:text-white"
              }`}
            >
              <m.icon className="h-4 w-4" /> {t(m.labelKey)}
            </button>
          );
        })}
      </div>

      {mode === "item" ? <ItemsTab /> : <LocationsTab />}

      {cartOpen && (
        <CartPanel items={cart.items} onRemove={cart.remove} onClear={cart.clear} onClose={() => setCartOpen(false)} />
      )}
    </div>
  );
}
