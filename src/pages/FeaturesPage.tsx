import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Pin } from "lucide-react";
import { FEATURE_ITEMS, FEATURE_CATEGORIES } from "../components/Layout";
import { groupFeaturesByCategory } from "../lib/featureGroups";
import { logError } from "../lib/logError";

/* Onglet « Fonctionnalités » : hub de tous les raccourcis, groupés par catégorie.
   C'est AUSSI l'endroit où l'on personnalise la barre du bas : chaque carte a un
   bouton « épingler » (max 5). Persistance backend (get/set_pinned_nav) + event
   navbar:pinned-changed → la barre du bas se met à jour en direct. */

const MAX_PINNED = 5;

export default function FeaturesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pinned, setPinned] = useState<string[]>([]);

  // Épinglés : chargés + rafraîchis en direct (émis par cette page ou ailleurs).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<string[]>("get_pinned_nav")
        .then((p) => !cancelled && setPinned(p))
        .catch((e) => logError("features.loadPinned", e));
    void load();
    const un = listen("navbar:pinned-changed", () => void load());
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);

  // Épingle / désépingle un raccourci (max 5), persiste puis notifie la barre du bas.
  function togglePin(route: string) {
    const isPinned = pinned.includes(route);
    if (!isPinned && pinned.length >= MAX_PINNED) return;
    const next = isPinned ? pinned.filter((r) => r !== route) : [...pinned, route];
    setPinned(next); // optimiste
    void invoke("set_pinned_nav", { routes: next })
      .then(() => emit("navbar:pinned-changed"))
      .catch((e) => logError("features.setPinned", e));
  }

  // Toutes les catégories/items (on n'exclut plus les épinglés : ils restent visibles,
  // surlignés, pour pouvoir les retirer directement).
  const groups = groupFeaturesByCategory(FEATURE_ITEMS, FEATURE_CATEGORIES, []);
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
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

      {/* Bandeau : personnalisation de la barre du bas (épinglage) */}
      <div
        className="mb-6 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs"
        style={{
          borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
          background: "color-mix(in oklab, var(--accent) 10%, transparent)",
          color: "color-mix(in oklab, var(--accent) 78%, white)",
        }}
      >
        <Pin className="h-4 w-4 shrink-0" />
        <span>{t("settings.navbar.sectionSubtitle")}</span>
        <span className="ml-auto shrink-0 font-medium tabular-nums">
          {t("features.pinnedCount", { n: pinned.length, max: MAX_PINNED })}
        </span>
      </div>

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
                  const isPinned = pinned.includes(item.to);
                  const atMax = !isPinned && pinned.length >= MAX_PINNED;
                  return (
                    <div
                      key={item.to}
                      className={[
                        "relative rounded-2xl border p-3.5 transition-colors",
                        isPinned
                          ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.07]"
                          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      <button
                        onClick={() => navigate(item.to)}
                        className="flex w-full items-center gap-3 pr-8 text-left"
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
                      <button
                        onClick={() => togglePin(item.to)}
                        disabled={atMax}
                        aria-label={isPinned ? t("features.unpin") : t("features.pin")}
                        title={
                          atMax
                            ? t("settings.navbar.maxReached", { max: MAX_PINNED })
                            : isPinned
                              ? t("features.unpin")
                              : t("features.pin")
                        }
                        className={[
                          "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
                          isPinned
                            ? "border-transparent bg-[var(--accent)] text-white"
                            : atMax
                              ? "cursor-not-allowed border-white/10 text-white/20"
                              : "border-white/10 bg-white/[0.04] text-white/40 hover:text-white/80",
                        ].join(" ")}
                      >
                        <Pin className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
