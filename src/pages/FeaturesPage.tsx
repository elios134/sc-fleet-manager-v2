import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { FEATURE_ITEMS, FEATURE_CATEGORIES } from "../components/Layout";
import { groupFeaturesByCategory } from "../lib/featureGroups";

/* Onglet « Fonctionnalités » : hub de tous les raccourcis, triés par catégorie.
   Les raccourcis épinglés à la navbar sont exclus (déjà accessibles → pas de doublon).
   Réutilise FEATURE_ITEMS / FEATURE_CATEGORIES (source unique, partagée avec la nav). */

export default function FeaturesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pinned, setPinned] = useState<string[]>([]);

  // Épinglés : chargés + rafraîchis en direct quand l'utilisateur en ajoute/retire.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<string[]>("get_pinned_nav")
        .then((p) => !cancelled && setPinned(p))
        .catch(() => {});
    void load();
    const un = listen("navbar:pinned-changed", () => void load());
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);

  const groups = groupFeaturesByCategory(FEATURE_ITEMS, FEATURE_CATEGORIES, pinned);
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <LayoutGrid className="h-6 w-6 text-[var(--accent)]" />
            {t("layout.features")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("features.subtitle")}</p>
        </div>
        <span className="shrink-0 text-xs text-white/40">
          {t("features.summary", { items: total, cats: groups.length })}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/40">
          {t("features.allPinned")}
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(({ category, items }) => {
            const CatIcon = category.icon;
            return (
              <section key={category.key}>
                <div className="mb-3 flex items-center gap-2">
                  <CatIcon className="h-[18px] w-[18px]" style={{ color: category.color }} />
                  <span className="text-[13px] font-medium tracking-wide text-white/70">
                    {t(category.labelKey)}
                  </span>
                  <span className="text-[11px] text-white/30">{items.length}</span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.to}
                        onClick={() => navigate(item.to)}
                        className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.05]"
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.04]"
                          style={{ color: category.color }}
                        >
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-white/90">{t(item.labelKey)}</span>
                          <span className="truncate text-xs text-white/50">{t(item.descKey)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
