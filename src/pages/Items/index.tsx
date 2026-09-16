import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import type { HangarItem, KindFilter, PledgeGroup } from "./types";
import { CHIPS, KIND_META, PER_PAGE, pageNumbers, pledgeMatchesKind } from "./helpers";
import ItemCard from "./components/ItemCard";
import ItemPackageCard from "./components/ItemPackageCard";
import ItemDetailsModal from "./components/ItemDetailsModal";
import ItemPackageModal from "./components/ItemPackageModal";
import KindChip from "./components/KindChip";
import PageBtn from "./components/PageBtn";

/* Onglet « Objets & cosmétiques » — refonte « Hangar Locker » : grille dense image-forward,
   badge de type coloré, packs empilés avec compteur. La pagination ne sert plus que de repli.
   Recherche/filtre/page persistants ; recharge sur `fleet:synced`. */

export default function ItemsCosmeticsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [groups, setGroups] = useState<PledgeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [search, setSearch] = usePersistentState("items.search", "");
  const [activeKind, setActiveKind] = usePersistentState<KindFilter>("items.kind", "ALL");
  const [currentPage, setCurrentPage] = usePersistentState("items.page", 1);

  const [openPackage, setOpenPackage] = usePersistentState<PledgeGroup | null>("items.openPackage", null);
  const [openSingle, setOpenSingle] = usePersistentState<{ item: HangarItem; pledgeName: string } | null>(
    "items.openSingle",
    null,
  );

  // Recharge après une synchronisation RSI (événement émis par Settings).
  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((v) => v + 1));
    return () => {
      void pending.then((un) => un());
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setNoAccount(true);
        return;
      }
      const rows = await invoke<HangarItem[]>("get_hangar_items", { accountId });
      // Groupage par pledgeId, en préservant l'ordre alphabétique des titres (déjà trié SQL).
      const byPledge = new Map<number, PledgeGroup>();
      for (const it of rows) {
        let g = byPledge.get(it.pledgeId);
        if (!g) {
          g = { id: it.pledgeId, name: it.pledgeName ?? t("items.pledgeFallback", { id: it.pledgeId }), items: [] };
          byPledge.set(it.pledgeId, g);
        }
        g.items.push(it);
      }
      setNoAccount(false);
      setGroups([...byPledge.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, location.key, reloadTick]);

  // Retour page 1 quand un filtre CHANGE réellement — pas au montage (préserve la page
  // restaurée). Comparaison à la valeur précédente → robuste au double-effet StrictMode.
  const prevPageKey = useRef(JSON.stringify([search, activeKind]));
  useEffect(() => {
    const key = JSON.stringify([search, activeKind]);
    if (prevPageKey.current !== key) {
      prevPageKey.current = key;
      setCurrentPage(1);
    }
  }, [search, activeKind, setCurrentPage]);

  // Recherche : nom du pledge + titre / kind / manufacturer de n'importe quel item.
  const matchesSearch = useCallback(
    (p: PledgeGroup) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.items.some(
          (it) =>
            it.title.toLowerCase().includes(q) ||
            (it.kind?.toLowerCase().includes(q) ?? false) ||
            (it.manufacturer?.toLowerCase().includes(q) ?? false),
        )
      );
    },
    [search],
  );

  const filtered = useMemo(
    () => groups.filter((p) => matchesSearch(p) && pledgeMatchesKind(p, activeKind)),
    [groups, matchesSearch, activeKind],
  );

  // Compteurs de chips indépendants de la recherche (reflètent tout le hangar).
  const chips = CHIPS.map(([labelKey, kind]) => ({
    label: t(labelKey),
    kind,
    count: groups.filter((p) => pledgeMatchesKind(p, kind)).length,
    active: activeKind === kind,
    meta: kind !== "ALL" && kind !== "OTHER" ? KIND_META[kind] : undefined,
  }));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageGroups = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  if (!loading && noAccount) {
    return (
      <div className="p-8">
        <p className="text-white/50">
          {t("items.noAccount")}{" "}
          <Link to="/" className="text-[var(--accent)] hover:underline">
            {t("items.selectCommander")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("items.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("items.title")}</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("items.loadingItems")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("common.errorPrefix")} {error}
        </p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">{t("items.emptyHangar")}</p>
          <Link
            to="/settings"
            className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {t("items.goToSettings")}
          </Link>
        </div>
      ) : (
        <>
          {/* Barre : recherche + filtres macro à icône */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("items.searchPlaceholder2")}
                className="h-9 w-full rounded-full border border-white/10 bg-white/5 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <KindChip
                  key={c.kind}
                  active={c.active}
                  onClick={() => setActiveKind(c.kind)}
                  label={c.label}
                  count={c.count}
                  Icon={c.meta?.Icon}
                  color={c.meta?.color}
                />
              ))}
            </div>
          </div>

          {/* Grille dense image-forward */}
          {filtered.length === 0 ? (
            <p className="text-sm text-white/40">{t("items.noMatch")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {pageGroups.map((p) =>
                p.items.length > 1 ? (
                  <ItemPackageCard key={`pkg-${p.id}`} pledge={p} onView={() => setOpenPackage(p)} t={t} />
                ) : (
                  <ItemCard
                    key={`item-${p.id}`}
                    item={p.items[0]!}
                    onClick={() => setOpenSingle({ item: p.items[0]!, pledgeName: p.name })}
                    t={t}
                  />
                ),
              )}
            </div>
          )}

          {/* Pagination (repli) */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <PageBtn disabled={safePage === 1} onClick={() => setCurrentPage(safePage - 1)}>
                ‹
              </PageBtn>
              {pageNumbers(safePage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`d-${i}`} className="px-1 text-white/30">
                    …
                  </span>
                ) : (
                  <PageBtn key={p} active={p === safePage} onClick={() => setCurrentPage(p)}>
                    {p}
                  </PageBtn>
                ),
              )}
              <PageBtn disabled={safePage === totalPages} onClick={() => setCurrentPage(safePage + 1)}>
                ›
              </PageBtn>
            </div>
          )}
        </>
      )}

      {openPackage && <ItemPackageModal pledge={openPackage} onClose={() => setOpenPackage(null)} />}
      {openSingle && (
        <ItemDetailsModal
          item={openSingle.item}
          pledgeName={openSingle.pledgeName}
          onClose={() => setOpenSingle(null)}
        />
      )}
    </div>
  );
}
