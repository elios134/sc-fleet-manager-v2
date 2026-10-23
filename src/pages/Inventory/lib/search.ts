// « Où est mon… ? » (logique pure, testée) : lieux de chaque objet suivi, recherche insensible
// aux accents avec filtre de catégorie, découpage pour surligner, recherches récentes.
import type { InvState, ItemMeta } from "../types";
import { categorie, categorieWiki, jolie } from "../aggregate";

/** Lieu d'un objet : « MOI » (sur soi) ou `L:<id>` (contenants repliés sur leur lieu). */
export type ItemPlace = { key: string; raw: string | null; qte: number; vu: number };
export type InvFilter = "all" | "weapons" | "armor" | "tools";
export type Hit = { classe: string; nom: string; imageUrl: string | null; total: number; places: ItemPlace[] };

const DIACRITICS = /[̀-ͯ]/g;
const fold = (s: string) => s.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
const compact = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

/** Lieux de chaque classe d'objet, de la plus grande quantité à la plus petite. */
export function itemPlaces(state: InvState): Map<string, ItemPlace[]> {
  const out = new Map<string, ItemPlace[]>();
  for (const [key, stacks] of Object.entries(state.possessions)) {
    let place = key;
    if (key.startsWith("C:")) {
      const lieu = state.contenants[key.slice(2)]?.lieu;
      if (lieu == null) continue;
      place = `L:${lieu}`;
    } else if (key !== "MOI" && !key.startsWith("L:")) continue;
    const raw = place === "MOI" ? null : state.lieux[place.slice(2)]?.nom ?? null;
    for (const [classe, s] of Object.entries(stacks)) {
      if (s.qte <= 0) continue;
      const list = out.get(classe) ?? [];
      const cur = list.find((p) => p.key === place);
      if (cur) {
        cur.qte += s.qte;
        cur.vu = Math.max(cur.vu, s.vu);
      } else list.push({ key: place, raw, qte: s.qte, vu: s.vu });
      out.set(classe, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.qte - a.qte);
  return out;
}

function kindOf(classe: string, m: ItemMeta | undefined): InvFilter {
  const cat = categorieWiki(m?.classification ?? null) ?? categorie(classe);
  if (cat === "Armes") return "weapons";
  if (cat === "Armure") return "armor";
  const util = (m?.classification ?? "").toLowerCase().startsWith("fps.utility");
  return util || /multi.?tool|tractor|tool/i.test(classe) ? "tools" : "all";
}

/** Objets dont le nom (ou la classe) contient la recherche, dans la catégorie demandée ; ceux
 *  dont le nom commence par la recherche d'abord, puis par nom. */
export function searchItems(state: InvState, meta: Record<string, ItemMeta>, query: string, filter: InvFilter): Hit[] {
  const q = fold(query.trim());
  const qc = compact(query);
  const hits: (Hit & { starts: boolean })[] = [];
  for (const [classe, places] of itemPlaces(state)) {
    const m = meta[classe];
    if (filter !== "all" && kindOf(classe, m) !== filter) continue;
    const nom = m?.name ?? jolie(classe);
    const fn = fold(nom);
    if (q && !fn.includes(q) && !compact(nom).includes(qc) && !compact(classe).includes(qc)) continue;
    const total = places.reduce((n, p) => n + p.qte, 0);
    hits.push({ classe, nom, imageUrl: m?.imageUrl ?? null, total, places, starts: !!q && fn.startsWith(q) });
  }
  return hits
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.nom.localeCompare(b.nom))
    .map(({ starts: _starts, ...h }) => h);
}

/** Morceaux de `text` à surligner là où il contient `query` (accents et casse ignorés). */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = fold(query.trim());
  // Repli caractère par caractère : les positions restent celles du texte d'origine.
  const folded = [...text].map((c) => fold(c) || c);
  const flat = folded.join("");
  const at = q ? flat.indexOf(q) : -1;
  if (at < 0) return [{ text, hit: false }];
  let pos = 0;
  let start = -1;
  let end = -1;
  folded.forEach((f, i) => {
    if (start < 0 && pos >= at) start = i;
    pos += f.length;
    if (end < 0 && pos >= at + q.length) end = i + 1;
  });
  const chars = [...text];
  return [
    { text: chars.slice(0, start).join(""), hit: false },
    { text: chars.slice(start, end).join(""), hit: true },
    { text: chars.slice(end).join(""), hit: false },
  ].filter((p) => p.text);
}

/** Ajoute une recherche en tête des récentes (5 au plus, sans doublon). */
export function pushRecent(list: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return list;
  return [q, ...list.filter((x) => fold(x) !== fold(q))].slice(0, 5);
}
