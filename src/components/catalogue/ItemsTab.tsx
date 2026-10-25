import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Search, PackageSearch } from "lucide-react";
import Dropdown from "../ui/Dropdown";
import { SidePanelLayout } from "../ui/SidePanel";
import { ShowMore } from "../ui/ShowMore";
import { usePersistentState } from "../../lib/uiPersist";
import { catLabel } from "../../lib/catalogLabels";
import { itemMakers, pageOf, sectionCounts, viewItems, PAGE_SIZE, type CatalogItem, type ItemSort } from "./itemsView";
import { ItemsTable } from "./ItemsTable";
import { ItemDetailBody } from "./ItemDetailBody";

/* Vue par ARTICLE (maquette docs/design/maquette-catalogue.html, proposition B) : tout le
   catalogue s'affiche dès l'ouverture (chargé une fois), filtrable par recherche, fabricant et
   rayon, triable ; la fiche de l'article choisi reste ouverte à droite (où l'acheter, panier,
   carte). Les points de vente sont chargés par la fiche (get_item_purchase_points). */

const chip = "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors";

export default function ItemsTab() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = usePersistentState("catalogue.items.search", "");
  const [section, setSection] = usePersistentState("catalogue.items.section", "");
  const [maker, setMaker] = usePersistentState("catalogue.items.maker", "");
  const [sort, setSort] = usePersistentState<ItemSort>("catalogue.items.sort", "name");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    invoke<CatalogItem[]>("get_catalog_items", { section: null, category: null, search: null })
      .then((r) => alive && setItems(r))
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => items ?? [], [items]);
  const view = useMemo(() => viewItems(all, { q: search, maker, section, sort }), [all, search, maker, section, sort]);
  const sections = useMemo(() => sectionCounts(all), [all]);
  const makers = useMemo(() => itemMakers(all), [all]);
  useEffect(() => setLimit(PAGE_SIZE), [search, maker, section, sort]);
  const { shown, rest } = pageOf(view, limit);
  const selected = view.find((it) => it.id === selectedId) ?? view[0] ?? null;
  const thumbUrl = (it: CatalogItem) => it.imageUrl ?? (it.uuid ? images[it.uuid] ?? null : null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("catalogue.searchItems")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white focus:border-[var(--accent)]/60 focus:outline-none"
          />
        </label>
        <Dropdown
          value={maker}
          onChange={setMaker}
          searchable
          ariaLabel={t("catalogue.colMaker")}
          className="w-56"
          options={[{ value: "", label: t("catalogue.allMakers") }, ...makers.map((m) => ({ value: m, label: m }))]}
        />
        <Dropdown
          value={sort}
          onChange={(v) => setSort(v as ItemSort)}
          ariaLabel={t("catalogue.sortLabel")}
          className="w-56"
          options={(["name", "price", "points"] as const).map((s) => ({ value: s, label: t(`catalogue.sort.${s}`) }))}
        />
        {items && <span className="text-[12px] tabular-nums text-white/40">{t("catalogue.countShown", { n: view.length, total: all.length })}</span>}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {[["", all.length] as [string, number], ...sections].map(([s, n]) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setSection(s)}
            className={`${chip} ${section === s ? "border-[var(--accent)]/50 bg-[var(--accent-muted)] text-white" : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"}`}
          >
            {s ? catLabel(s, i18n.language) : t("catalogue.filterAll")} <span className="tabular-nums opacity-50">{n}</span>
          </button>
        ))}
      </div>

      {items == null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
        </div>
      ) : view.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-2xl glass text-center text-white/40">
          <PackageSearch className="h-8 w-8 opacity-40" />
          <p className="text-sm">{t(failed ? "catalogue.loadFailed" : all.length ? "catalogue.noItemFound" : "catalogue.emptyCatalog")}</p>
        </div>
      ) : (
        <SidePanelLayout
          panel={
            selected && (
              <ItemDetailBody
                key={selected.id}
                compact
                item={{ ...selected, idItem: selected.id }}
                onImage={(uuid, url) => setImages((prev) => (prev[uuid] === url ? prev : { ...prev, [uuid]: url }))}
              />
            )
          }
        >
          <div className="glass overflow-x-auto rounded-2xl px-1.5 py-1">
            <ItemsTable items={shown} selectedId={selected?.id ?? null} onSelect={(it) => setSelectedId(it.id)} thumbUrl={thumbUrl} />
            <ShowMore rest={rest} step={PAGE_SIZE} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
          </div>
        </SidePanelLayout>
      )}
    </div>
  );
}
