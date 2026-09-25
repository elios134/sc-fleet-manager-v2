import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Search, Store, MapPin, ChevronRight, ChevronDown } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import { catLabel } from "../../lib/catalogLabels";
import { fmt, locationStr, sysColor, macroGroupOf, itemIcon, type MacroGroup } from "./shared";
import { FreshnessPill } from "./FreshnessPill";
import { ItemThumb } from "./ItemThumb";
import { ItemDetailModal } from "./ItemDetailModal";

/* Vue par lieu (onglet principal du Catalogue) : terminal/station → tout ce qu'on peut y
   acheter. Filtres macro Vaisseaux/FPS/Autres + recherche d'article + images. Clic item →
   modale de détail complet. Données get_catalog_terminals + get_terminal_items. */

type CatalogTerminal = {
  idTerminal: number | null;
  terminalName: string | null;
  systemName: string | null;
  planetName: string | null;
  moonName: string | null;
  cityName: string | null;
  spaceStationName: string | null;
  outpostName: string | null;
  itemCount: number;
  minPrice: number | null;
  lastModified: number | null;
};
type TerminalItem = {
  idItem: number | null;
  uuid: string | null;
  name: string | null;
  priceBuy: number | null;
  dateModified: number | null;
  section: string | null;
  category: string | null;
  companyName: string | null;
  size: string | null;
  imageUrl: string | null;
};

const GROUPS: Array<{ key: MacroGroup | ""; labelKey: string }> = [
  { key: "", labelKey: "catalogue.filterAll" },
  { key: "vehicle", labelKey: "catalogue.grpShips" },
  { key: "character", labelKey: "catalogue.grpFps" },
  { key: "misc", labelKey: "catalogue.grpOther" },
];

export default function LocationsTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [terminals, setTerminals] = useState<CatalogTerminal[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = usePersistentState("catalogue.locations.search", "");
  const [selected, setSelected] = usePersistentState<CatalogTerminal | null>("catalogue.locations.selected", null);
  const [group, setGroup] = usePersistentState<MacroGroup | "">("catalogue.locations.group", "");
  // Repli de l'arbre gauche : clés `sys:<système>` et `place:<système>/<lieu>` → true = replié.
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>("catalogue.locations.collapsed", {});
  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState<TerminalItem[] | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [modalItem, setModalItem] = useState<TerminalItem | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<CatalogTerminal[]>("get_catalog_terminals", { search: null })
      .then((r) => alive && setTerminals(r))
      .catch(() => alive && setTerminals([]))
      .finally(() => alive && setLoadingList(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const term = selected;
    if (!term?.idTerminal) { setItems(null); return; }
    let alive = true;
    setItems(null);
    setItemSearch("");
    invoke<TerminalItem[]>("get_terminal_items", { idTerminal: term.idTerminal })
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.idTerminal]);

  // Lieu (planète/station) de regroupement de niveau 2.
  const placeOf = (tm: CatalogTerminal) =>
    tm.planetName || tm.spaceStationName || tm.moonName || tm.outpostName || tm.cityName || t("catalogue.unknownPlace");
  // Sous-lieu fin affiché sur la ligne (sous le nom de boutique) s'il diffère du groupe.
  const spotOf = (tm: CatalogTerminal, place: string) => {
    const spot = tm.cityName || tm.outpostName || tm.moonName || tm.spaceStationName || null;
    return spot && spot !== place ? spot : null;
  };

  const searching = search.trim().length > 0;
  // Arbre Système → Lieu → terminaux (filtré par la recherche terminal).
  const tree = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = terminals.filter(
      (tm) => !s || (tm.terminalName ?? "").toLowerCase().includes(s) || locationStr(tm).toLowerCase().includes(s),
    );
    const systems = new Map<string, Map<string, CatalogTerminal[]>>();
    for (const tm of list) {
      const sys = tm.systemName ?? "—";
      const place = placeOf(tm);
      if (!systems.has(sys)) systems.set(sys, new Map());
      const places = systems.get(sys)!;
      (places.get(place) ?? places.set(place, []).get(place)!).push(tm);
    }
    return Array.from(systems.entries()).map(([sys, places]) => ({
      sys,
      places: Array.from(places.entries()),
      count: Array.from(places.values()).reduce((a, b) => a + b.length, 0),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals, search, lang]);

  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const selId = selected?.idTerminal ?? null;

  // Compte par macro-groupe (pour les puces) + liste filtrée (groupe + recherche article).
  const groupCounts = useMemo(() => {
    const c: Record<string, number> = { "": items?.length ?? 0, vehicle: 0, character: 0, misc: 0 };
    for (const it of items ?? []) c[macroGroupOf(it.section)]++;
    return c;
  }, [items]);

  const shownItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return (items ?? []).filter(
      (it) => (!group || macroGroupOf(it.section) === group) && (!q || (it.name ?? "").toLowerCase().includes(q)),
    );
  }, [items, group, itemSearch]);

  const thumbUrl = (it: TerminalItem) => it.imageUrl ?? (it.uuid ? images[it.uuid] ?? null : null);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
      {/* GAUCHE : terminaux groupés par système */}
      <div className="flex max-h-[calc(100vh-200px)] flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("catalogue.searchTerminal")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {loadingList ? (
            <div className="flex items-center gap-2 py-6 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
            </div>
          ) : tree.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/40">{t("catalogue.noTerminal")}</p>
          ) : (
            tree.map(({ sys, places, count }) => {
              const sysKey = `sys:${sys}`;
              const sysColorV = sysColor(sys === "—" ? null : sys);
              // Repli manuel prioritaire même avec une sélection : seule une recherche active
              // force l'ouverture. `hasSel` retiré → une section reste repliable une fois sélectionnée.
              const sysOpen = searching || !collapsed[sysKey];
              return (
                <div key={sys} className="mb-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(sysKey)}
                    className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] hover:bg-white/5"
                    style={{ color: sysColorV }}
                  >
                    {sysOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: sysColorV }} />
                    {sys === "—" ? t("catalogue.unknownSystem") : sys}
                    <span className="ml-auto font-normal text-white/35">{count}</span>
                  </button>

                  {sysOpen &&
                    places.map(([place, terms]) => {
                      const placeKey = `place:${sys}/${place}`;
                      const placeOpen = searching || !collapsed[placeKey];
                      return (
                        <div key={place} className="ml-2 border-l border-white/[0.06] pl-2">
                          <button
                            type="button"
                            onClick={() => toggle(placeKey)}
                            className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/5"
                          >
                            {placeOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{place}</span>
                            <span className="ml-auto text-[10px] text-white/30">{t("catalogue.terminalsN", { n: terms.length })}</span>
                          </button>

                          {placeOpen && (
                            <div className="mb-1 flex flex-col gap-1.5 pt-0.5">
                              {terms.map((tm) => {
                                const active = selId === tm.idTerminal;
                                const spot = spotOf(tm, place);
                                return (
                                  <button
                                    key={tm.idTerminal}
                                    type="button"
                                    onClick={() => setSelected(tm)}
                                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                                      active ? "border-[var(--accent)]/60 bg-[var(--accent)]/10" : "border-white/10 bg-black/20 hover:bg-white/5"
                                    }`}
                                  >
                                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-white/[0.04] ${active ? "text-[var(--accent)]" : "text-white/40"}`}>
                                      <Store className="h-4 w-4" />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                      <span className="truncate text-[12.5px] font-medium text-white">{tm.terminalName ?? "—"}</span>
                                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/45">
                                        {spot && <span className="truncate">{spot}</span>}
                                        <FreshnessPill dateModified={tm.lastModified} t={t} />
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right">
                                      <span className="block text-[12.5px] font-semibold tabular-nums text-white">{tm.itemCount}</span>
                                      <span className="block text-[9px] text-white/35">{t("catalogue.itemsShort")}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* DROITE : articles du terminal choisi */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        {!selected ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-white/40">
            <Store className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("catalogue.selectTerminal")}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start gap-3.5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[13px] border border-white/10 text-[var(--accent)]" style={{ background: "linear-gradient(135deg,rgba(99,102,241,.2),rgba(139,92,246,.08))" }}>
                <Store className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-white">{selected.terminalName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-white/55">
                  <MapPin className="h-3.5 w-3.5" /> {locationStr(selected)}
                  <FreshnessPill dateModified={selected.lastModified} t={t} prefix />
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-center">
                  <span className="block text-[9px] uppercase text-white/40">{t("catalogue.itemsShort")}</span>
                  <span className="block text-[15px] font-bold tabular-nums text-white">{selected.itemCount}</span>
                </span>
                <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-center">
                  <span className="block text-[9px] uppercase text-white/40">{t("catalogue.from")}</span>
                  <span className="block text-[15px] font-bold tabular-nums text-emerald-400">{fmt(selected.minPrice)}</span>
                </span>
              </div>
            </div>

            {/* Recherche d'article + filtres macro */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={t("catalogue.searchItemHere")}
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

            {items == null ? (
              <div className="flex items-center gap-2 py-4 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
              </div>
            ) : shownItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/40">{t("catalogue.noItemHere")}</p>
            ) : (
              <div className="flex flex-col">
                {shownItems.map((it, i) => (
                  <button
                    key={`${it.idItem}-${i}`}
                    type="button"
                    onClick={() => setModalItem(it)}
                    className="group flex items-center gap-3 border-t border-white/[0.06] py-2.5 text-left first:border-t-0 hover:bg-white/[0.02]"
                  >
                    <ItemThumb imageUrl={thumbUrl(it)} icon={itemIcon(it.section, it.category)} size={78} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-white">{it.name}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/45">
                        {it.category && <span className="truncate">{catLabel(it.category, lang)}</span>}
                        <FreshnessPill dateModified={it.dateModified} t={t} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-[14px] font-bold tabular-nums text-emerald-400">{fmt(it.priceBuy)}</span>
                      <span className="ml-1 text-[10px] text-white/45">{t("catalogue.aUEC")}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/20 transition-colors group-hover:text-white/50" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modalItem && (
        <ItemDetailModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onImage={(uuid, url) => setImages((prev) => (prev[uuid] === url ? prev : { ...prev, [uuid]: url }))}
        />
      )}
    </div>
  );
}
