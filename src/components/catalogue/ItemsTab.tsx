import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Search, ChevronRight, PackageSearch } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import { catLabel } from "../../lib/catalogLabels";
import { fmt, macroGroupOf, itemIcon, type MacroGroup } from "./shared";
import { ItemThumb } from "./ItemThumb";
import { ItemDetailModal } from "./ItemDetailModal";

/* Vue par ARTICLE (Item Finder direct) : on cherche un item par son nom → liste des articles
   correspondants (image + nb de points de vente + prix mini). Clic → modale de détail qui
   liste TOUS les endroits où il est vendu (triés par prix). Données get_catalog_items ; les
   points de vente sont chargés par la modale (get_item_purchase_points). */

type CatalogItem = {
  id: number;
  uuid: string | null;
  name: string | null;
  section: string | null;
  category: string | null;
  companyName: string | null;
  size: string | null;
  imageUrl: string | null;
  sellPoints: number;
  minPrice: number | null;
};

const GROUPS: Array<{ key: MacroGroup | ""; labelKey: string }> = [
  { key: "", labelKey: "catalogue.filterAll" },
  { key: "vehicle", labelKey: "catalogue.grpShips" },
  { key: "character", labelKey: "catalogue.grpFps" },
  { key: "misc", labelKey: "catalogue.grpOther" },
];

const MIN_CHARS = 2;

export default function ItemsTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [search, setSearch] = usePersistentState("catalogue.items.search", "");
  const [group, setGroup] = usePersistentState<MacroGroup | "">("catalogue.items.group", "");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [modalItem, setModalItem] = useState<CatalogItem | null>(null);

  const q = search.trim();
  // Recherche debouncée (250 ms) ; min 2 caractères pour éviter de charger tout le catalogue.
  useEffect(() => {
    if (q.length < MIN_CHARS) {
      setItems(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const h = setTimeout(() => {
      invoke<CatalogItem[]>("get_catalog_items", { section: null, category: null, search: q })
        .then((r) => alive && setItems(r))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = { "": items?.length ?? 0, vehicle: 0, character: 0, misc: 0 };
    for (const it of items ?? []) c[macroGroupOf(it.section)]++;
    return c;
  }, [items]);

  const shown = useMemo(
    () => (items ?? []).filter((it) => !group || macroGroupOf(it.section) === group),
    [items, group],
  );

  const thumbUrl = (it: CatalogItem) => it.imageUrl ?? (it.uuid ? images[it.uuid] ?? null : null);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      {/* Recherche d'article + filtres macro */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("catalogue.search")}
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key || "all"}
            type="button"
            onClick={() => setGroup(g.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              group === g.key ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"
            }`}
          >
            {t(g.labelKey)} <span className="opacity-50">{groupCounts[g.key]}</span>
          </button>
        ))}
      </div>

      {q.length < MIN_CHARS ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center text-white/40">
          <PackageSearch className="h-8 w-8 opacity-40" />
          <p className="text-sm">{t("catalogue.selectItem")}</p>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">{t("catalogue.noItemFound")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {shown.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setModalItem(it)}
              className="group flex items-center gap-3 border-t border-white/[0.06] py-2.5 text-left hover:bg-white/[0.02]"
            >
              <ItemThumb imageUrl={thumbUrl(it)} icon={itemIcon(it.section, it.category)} size={64} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-white">{it.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/45">
                  {it.category && <span className="truncate">{catLabel(it.category, lang)}</span>}
                  <span className="shrink-0">{t("catalogue.sellPoints", { n: it.sellPoints })}</span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[9px] uppercase text-white/35">{t("catalogue.from")}</span>
                <span className="text-[13.5px] font-bold tabular-nums text-emerald-400">{fmt(it.minPrice)}</span>
                <span className="ml-1 text-[10px] text-white/45">{t("catalogue.aUEC")}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-white/20 transition-colors group-hover:text-white/50" />
            </button>
          ))}
        </div>
      )}

      {modalItem && (
        <ItemDetailModal
          item={{
            idItem: modalItem.id,
            uuid: modalItem.uuid,
            name: modalItem.name,
            section: modalItem.section,
            category: modalItem.category,
            companyName: modalItem.companyName,
            size: modalItem.size,
            imageUrl: modalItem.imageUrl,
          }}
          onClose={() => setModalItem(null)}
          onImage={(uuid, url) => setImages((prev) => (prev[uuid] === url ? prev : { ...prev, [uuid]: url }))}
        />
      )}
    </div>
  );
}
