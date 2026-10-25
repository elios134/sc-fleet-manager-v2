// Vue « Par article » du Catalogue (logique pure, testée) : tout le catalogue est chargé une
// fois (≈ 3 000 articles, ~0,1 s), puis filtré, trié et affiché par pages ici.

/** Article du catalogue (commande `get_catalog_items`). */
export type CatalogItem = {
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
export type ItemSort = "name" | "price" | "points";
export type ItemFilter = { q: string; maker: string; section: string; sort: ItemSort };

export const PAGE_SIZE = 60;

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const byName = (a: CatalogItem, b: CatalogItem) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
const SORTS: Record<ItemSort, (a: CatalogItem, b: CatalogItem) => number> = {
  name: byName,
  // Sans prix connu : en dernier.
  price: (a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity) || byName(a, b),
  points: (a, b) => b.sellPoints - a.sellPoints || byName(a, b),
};

/** Articles filtrés (nom ou fabricant, fabricant exact, rayon) puis triés. */
export function viewItems(items: CatalogItem[], f: ItemFilter): CatalogItem[] {
  const q = norm(f.q.trim());
  return items
    .filter((it) => (!q || norm(`${it.name} ${it.companyName}`).includes(q)) && (!f.maker || it.companyName === f.maker) && (!f.section || it.section === f.section))
    .sort(SORTS[f.sort]);
}

/** Nombre d'articles par rayon, du plus fourni au moins fourni. */
export function sectionCounts(items: CatalogItem[]): [string, number][] {
  const c = new Map<string, number>();
  for (const it of items) if (it.section) c.set(it.section, (c.get(it.section) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Fabricants présents, triés. */
export function itemMakers(items: CatalogItem[]): string[] {
  return [...new Set(items.map((it) => it.companyName).filter((m): m is string => !!m))].sort((a, b) => a.localeCompare(b));
}

/** Les `limit` premiers articles et le nombre restant à afficher. */
export function pageOf<T>(list: T[], limit: number): { shown: T[]; rest: number } {
  return { shown: list.slice(0, limit), rest: Math.max(0, list.length - limit) };
}
