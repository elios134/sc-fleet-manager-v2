import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Loader2, Search, Store, PackageSearch, ExternalLink, MapPin } from "lucide-react";
import Dropdown from "../components/ui/Dropdown";
import StatCard from "../components/ui/StatCard";
import { catLabel } from "../lib/catalogLabels";

/* ── Types (miroir des commandes catalog.rs) ── */
type CategoryGroup = { section: string; categories: string[] };
type CatalogItem = {
  id: number;
  uuid: string | null;
  name: string | null;
  slug: string | null;
  section: string | null;
  category: string | null;
  companyName: string | null;
  size: string | null;
  idVehicle: number | null;
  vehicleName: string | null;
  urlStore: string | null;
  sellPoints: number;
  minPrice: number | null;
};
type PurchasePoint = {
  priceBuy?: number | null;
  price?: number | null;
  terminalName: string | null;
  shopName?: string | null;
  systemName: string | null;
  planetName: string | null;
  moonName: string | null;
  cityName: string | null;
  spaceStationName: string | null;
  outpostName: string | null;
  dateModified: number | null;
};
type ItemStat = { name: string; value: string };
type ItemWikiDetail = {
  available: boolean;
  description: string | null;
  manufacturer: string | null;
  typeLabel: string | null;
  subTypeLabel: string | null;
  size: number | null;
  grade: string | null;
  webUrl: string | null;
  stats: ItemStat[];
};
type CatalogVehicle = {
  idVehicle: number | null;
  vehicleName: string | null;
  hasPurchase: boolean;
  hasRental: boolean;
  minBuy: number | null;
  minRent: number | null;
  manufacturer: string | null;
  role: string | null;
  classification: string | null;
  cargoScu: number | null;
  imageUrl: string | null;
  size: string | null;
  priceUec: number | null;
  crewMin: number | null;
  crewMax: number | null;
  scmSpeed: number | null;
  shieldHp: number | null;
  hullHp: number | null;
};
type VehicleMarketplace = { purchase: PurchasePoint[]; rental: PurchasePoint[] };

/* ── Helpers ── */
function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("fr-FR");
}
function crewLabel(v: CatalogVehicle): string {
  const a = v.crewMin;
  const b = v.crewMax;
  if (a != null && b != null) return a === b ? `${a}` : `${a}–${b}`;
  return `${a ?? b ?? "—"}`;
}
function locationStr(p: PurchasePoint): string {
  const place = p.spaceStationName || p.cityName || p.outpostName || p.moonName || p.planetName;
  const uniq = [place, p.systemName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  return uniq.length ? uniq.join(" · ") : "—";
}

// Macro-groupes maison (UEX éclate les équipements sur plusieurs sections) : filtre
// PRINCIPAL = groupe ; SOUS-FILTRE = sous-catégorie fine. Une section inconnue → "misc".
type MacroGroup = "vehicle" | "character" | "misc";
const VEHICLE_SECTIONS = new Set(["Vehicle Weapons", "Systems", "Avionics", "Propulsion", "Utility", "Module"]);
const CHARACTER_SECTIONS = new Set(["Armor", "Personal Weapons", "Undersuits", "Clothing"]);
function macroGroupOf(section: string | null): MacroGroup {
  if (section && VEHICLE_SECTIONS.has(section)) return "vehicle";
  if (section && CHARACTER_SECTIONS.has(section)) return "character";
  return "misc";
}

export default function CataloguePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"items" | "vehicles">("items");

  return (
    <div className="p-8">
      <header className="mb-1">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("catalogue.eyebrow")}</p>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Store className="h-6 w-6 text-[var(--accent)]" /> {t("catalogue.title")}
        </h1>
      </header>

      <div className="mb-5 mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("items")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "items" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("catalogue.tabItems")}
        </button>
        <button
          type="button"
          onClick={() => setTab("vehicles")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "vehicles" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("catalogue.tabVehicles")}
        </button>
      </div>

      {tab === "items" ? <ItemsTab /> : <VehiclesTab />}
    </div>
  );
}

/* ════════════════════════════ ONGLET ACHETABLE ════════════════════════════ */
function ItemsTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [group, setGroup] = useState<MacroGroup | "">("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [allItems, setAllItems] = useState<CatalogItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [detail, setDetail] = useState<ItemWikiDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [points, setPoints] = useState<PurchasePoint[] | null>(null);
  const detailCache = useRef<Map<string, ItemWikiDetail>>(new Map());

  // Chargement UNIQUE : taxonomie + tous les items vendus → filtrage en mémoire ensuite.
  useEffect(() => {
    let alive = true;
    Promise.all([
      invoke<CategoryGroup[]>("get_item_categories"),
      invoke<CatalogItem[]>("get_catalog_items", { section: null, category: null, search: null }),
    ])
      .then(([cats, items]) => {
        if (!alive) return;
        setCategories(cats);
        setAllItems(items);
      })
      .catch(() => {
        if (!alive) return;
        setCategories([]);
        setAllItems([]);
      })
      .finally(() => alive && setLoadingList(false));
    return () => {
      alive = false;
    };
  }, []);

  // Sous-catégories du groupe choisi (union des sous-catégories de ses sections).
  const subcategories = useMemo(() => {
    if (!group) return [];
    const set = new Set<string>();
    for (const cg of categories) {
      if (macroGroupOf(cg.section) === group) cg.categories.forEach((c) => set.add(c));
    }
    return Array.from(set).sort();
  }, [categories, group]);

  // Filtrage en mémoire : groupe + sous-catégorie + recherche.
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return allItems.filter((it) => {
      if (group && macroGroupOf(it.section) !== group) return false;
      if (category && it.category !== category) return false;
      if (s && !(it.name ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [allItems, group, category, search]);

  async function selectItem(it: CatalogItem) {
    setSelected(it);
    setPoints(null);
    setDetail(null);
    // Points de vente (base, rapide).
    invoke<PurchasePoint[]>("get_item_purchase_points", { idItem: it.id, uuid: it.uuid })
      .then(setPoints)
      .catch(() => setPoints([]));
    // Détail Wiki LAZY + cache par uuid.
    if (!it.uuid) {
      setDetail({ available: false, description: null, manufacturer: null, typeLabel: null, subTypeLabel: null, size: null, grade: null, webUrl: null, stats: [] });
      return;
    }
    const cached = detailCache.current.get(it.uuid);
    if (cached) {
      setDetail(cached);
      return;
    }
    setLoadingDetail(true);
    try {
      const d = await invoke<ItemWikiDetail>("get_item_wiki_detail", { uuid: it.uuid });
      detailCache.current.set(it.uuid, d);
      setDetail(d);
    } catch {
      setDetail({ available: false, description: null, manufacturer: null, typeLabel: null, subTypeLabel: null, size: null, grade: null, webUrl: null, stats: [] });
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* GAUCHE : filtres + liste */}
      <div className="flex max-h-[calc(100vh-220px)] flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("catalogue.search")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
          />
        </div>
        <div className="mb-2">
          <Dropdown
            value={group}
            onChange={(v) => {
              setGroup(v as MacroGroup | "");
              setCategory("");
            }}
            ariaLabel={t("catalogue.filterGroup")}
            options={[
              { value: "", label: t("catalogue.allSections") },
              { value: "vehicle", label: t("catalogue.groupVehicle") },
              { value: "character", label: t("catalogue.groupCharacter") },
              { value: "misc", label: t("catalogue.groupMisc") },
            ]}
          />
        </div>
        <div className="mb-3">
          <Dropdown
            value={category}
            onChange={setCategory}
            ariaLabel={t("catalogue.filterCategory")}
            disabled={!group}
            searchable
            options={[
              { value: "", label: t("catalogue.allCategories") },
              ...subcategories.map((c) => ({ value: c, label: catLabel(c, lang) })),
            ]}
          />
        </div>

        <p className="mb-2 text-[11px] text-white/40">{t("catalogue.itemsCount", { n: filtered.length })}</p>

        <div className="flex-1 overflow-y-auto pr-1">
          {loadingList ? (
            <div className="flex items-center gap-2 py-6 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => void selectItem(it)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected?.id === it.id
                      ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                      : "border-white/10 bg-black/20 hover:bg-white/5"
                  }`}
                >
                  <div className="truncate text-sm font-medium text-white">{it.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
                    {it.companyName && <span className="truncate">{it.companyName}</span>}
                    {it.companyName && it.category && <span>·</span>}
                    {it.category && <span className="truncate">{catLabel(it.category, lang)}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DROITE : détail */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        {!selected ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-white/40">
            <PackageSearch className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("catalogue.selectItem")}</p>
          </div>
        ) : (
          <>
            <header className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                {[catLabel(selected.section, lang), catLabel(detail?.subTypeLabel ?? selected.category, lang)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <h2 className="mt-0.5 text-xl font-bold text-white">{selected.name}</h2>
              <p className="mt-0.5 text-sm text-white/55">
                {detail?.manufacturer ?? selected.companyName ?? ""}
                {selected.size ? ` · ${t("catalogue.sizeShort")}${selected.size}` : ""}
              </p>
            </header>

            {/* Descriptif + stats (lazy) */}
            {loadingDetail ? (
              <div className="flex items-center gap-2 py-4 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
              </div>
            ) : (
              <>
                {detail?.description && (
                  <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-white/70">
                    {detail.description}
                  </p>
                )}
                {detail && detail.stats.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">
                      {t("catalogue.stats")}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {detail.stats.map((s, i) => (
                        <div key={i} className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-white/40">{s.name}</div>
                          <div className="text-sm font-semibold text-white/90">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail?.webUrl && (
                  <button
                    type="button"
                    onClick={() => void openUrl(detail.webUrl as string).catch(() => {})}
                    className="mb-4 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline"
                  >
                    {t("catalogue.openWiki")} <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </>
            )}

            {/* Où acheter */}
            <div className="border-t border-white/10 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">
                {t("catalogue.whereToBuy")}
              </p>
              {points == null ? (
                <div className="flex items-center gap-2 py-2 text-sm text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
                </div>
              ) : points.length === 0 ? (
                <p className="py-2 text-sm text-white/40">{t("catalogue.noPurchase")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {points.map((p, i) => (
                    <PriceCard key={i} p={p} price={p.priceBuy} t={t} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════ ONGLET VAISSEAUX ════════════════════════════ */
function VehiclesTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [all, setAll] = useState<CatalogVehicle[]>([]);
  const [role, setRole] = useState("");
  const [availability, setAvailability] = useState("");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<CatalogVehicle | null>(null);
  const [market, setMarket] = useState<VehicleMarketplace | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);

  useEffect(() => {
    invoke<CatalogVehicle[]>("get_catalog_vehicles", { role: null, availability: null, search: null })
      .then(setAll)
      .catch(() => setAll([]));
  }, []);

  const roles = useMemo(
    () => Array.from(new Set(all.map((v) => v.role).filter((r): r is string => !!r))).sort(),
    [all],
  );

  const filtered = useMemo(() => {
    return all.filter((v) => {
      if (role && v.role !== role) return false;
      if (availability === "purchase" && !v.hasPurchase) return false;
      if (availability === "rental" && !v.hasRental) return false;
      if (search && !(v.vehicleName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [all, role, availability, search]);

  function selectVehicle(v: CatalogVehicle) {
    setSelected(v);
    setMarket(null);
    setLoadingMarket(true);
    invoke<VehicleMarketplace>("get_vehicle_marketplace", {
      idVehicle: v.idVehicle,
      vehicleName: v.vehicleName,
    })
      .then(setMarket)
      .catch(() => setMarket({ purchase: [], rental: [] }))
      .finally(() => setLoadingMarket(false));
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* GAUCHE */}
      <div className="flex max-h-[calc(100vh-220px)] flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("catalogue.search")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white focus:outline-none"
          />
        </div>
        <div className="mb-2">
          <Dropdown
            value={role}
            onChange={setRole}
            ariaLabel={t("catalogue.filterRole")}
            searchable
            options={[
              { value: "", label: t("catalogue.allRoles") },
              ...roles.map((r) => ({ value: r, label: catLabel(r, lang) })),
            ]}
          />
        </div>
        <div className="mb-3">
          <Dropdown
            value={availability}
            onChange={setAvailability}
            ariaLabel={t("catalogue.filterAvailability")}
            options={[
              { value: "", label: t("catalogue.availAll") },
              { value: "purchase", label: t("catalogue.availPurchase") },
              { value: "rental", label: t("catalogue.availRental") },
            ]}
          />
        </div>

        <p className="mb-2 text-[11px] text-white/40">{t("catalogue.vehiclesCount", { n: filtered.length })}</p>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1.5">
            {filtered.map((v) => (
              <button
                key={`${v.idVehicle}-${v.vehicleName}`}
                type="button"
                onClick={() => selectVehicle(v)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected?.idVehicle === v.idVehicle
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                }`}
              >
                <div className="truncate text-sm font-medium text-white">{v.vehicleName}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
                  {v.manufacturer && <span className="truncate">{v.manufacturer}</span>}
                  {v.manufacturer && v.role && <span>·</span>}
                  {v.role && <span className="truncate">{catLabel(v.role, lang)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DROITE */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        {!selected ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-white/40">
            <Store className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("catalogue.selectVehicle")}</p>
          </div>
        ) : (
          <>
            <header className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                {[catLabel(selected.role, lang), catLabel(selected.classification, lang)].filter(Boolean).join(" · ")}
              </p>
              <h2 className="mt-0.5 text-xl font-bold text-white">{selected.vehicleName}</h2>
              <p className="mt-0.5 text-sm text-white/55">{selected.manufacturer ?? ""}</p>
            </header>

            {/* Cartes de stats (ShipData) — masque toute carte sans donnée */}
            <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {selected.cargoScu != null && (
                <StatCard label={t("catalogue.cargo")} value={`${fmt(selected.cargoScu)} SCU`} />
              )}
              {(selected.crewMin != null || selected.crewMax != null) && (
                <StatCard label={t("catalogue.crew")} value={crewLabel(selected)} />
              )}
              {selected.size && <StatCard label={t("catalogue.size")} value={selected.size} />}
              {selected.scmSpeed != null && (
                <StatCard label={t("catalogue.scmSpeed")} value={`${fmt(selected.scmSpeed)} m/s`} />
              )}
              {selected.shieldHp != null && selected.shieldHp > 0 && (
                <StatCard label={t("catalogue.shield")} value={fmt(selected.shieldHp)} />
              )}
              {selected.hullHp != null && selected.hullHp > 0 && (
                <StatCard label={t("catalogue.hull")} value={fmt(selected.hullHp)} />
              )}
              {selected.priceUec != null && selected.priceUec > 0 && (
                <StatCard label={t("catalogue.basePrice")} value={`${fmt(selected.priceUec)} aUEC`} />
              )}
            </div>

            {loadingMarket ? (
              <div className="flex items-center gap-2 py-4 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
              </div>
            ) : (
              (() => {
                // Le détail suit le filtre disponibilité : Tous → 2 sections ;
                // Achat → Acheter seule ; Location → Louer seule.
                const showBuy = availability !== "rental";
                const showRent = availability !== "purchase";
                return (
                  <div className={`grid grid-cols-1 gap-4 ${showBuy && showRent ? "lg:grid-cols-2" : ""}`}>
                    {showBuy && (
                      <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-300/80">
                          {t("catalogue.buy")}
                        </p>
                        {!market || market.purchase.length === 0 ? (
                          <p className="py-2 text-sm text-white/40">{t("catalogue.noPurchaseVeh")}</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {market.purchase.map((p, i) => (
                              <PriceCard key={i} p={p} price={p.price} t={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {showRent && (
                      <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sky-300/80">
                          {t("catalogue.rent")}
                        </p>
                        {!market || market.rental.length === 0 ? (
                          <p className="py-2 text-sm text-white/40">{t("catalogue.noRental")}</p>
                        ) : (
                          <>
                            <div className="flex flex-col gap-2">
                              {market.rental.map((p, i) => (
                                <PriceCard key={i} p={p} price={p.price} t={t} />
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] italic text-white/35">
                              {t("catalogue.rentalNoDuration")}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Carte d'un point de vente : magasin + lieu + prix ── */
function PriceCard({
  p,
  price,
  t,
}: {
  p: PurchasePoint;
  price: number | null | undefined;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const shop = p.shopName || p.terminalName || "—";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-white/90">{shop}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-white/45">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{locationStr(p)}</span>
        </div>
      </div>
      <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">
        {fmt(price)} <span className="text-[10px] text-white/50">{t("catalogue.aUEC")}</span>
      </span>
    </div>
  );
}
