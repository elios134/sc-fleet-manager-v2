// Notes de version (texte des releases GitHub, repris par l'updater) : lecture du Markdown
// simple qu'on publie (« ## Section » + puces « - **Titre** — texte ») et règles d'affichage
// de la fenêtre « Quoi de neuf ». Logique pure, testée.

export type NoteItem = { title: string; text: string };
export type NoteSection = { title: string; items: NoteItem[] };

const strip = (s: string) => s.replace(/\*\*/g, "").trim();

/** « **Titre** — texte », « Titre : texte », « Titre - texte » ou texte seul. */
function parseItem(line: string): NoteItem {
  const bold = /^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/.exec(line);
  if (bold) return { title: bold[1].trim(), text: strip(bold[2]) };
  const sep = /^(.+?)\s+(?:—|–|-|:)\s+(.+)$/.exec(line) ?? /^(.+?)\s*:\s+(.+)$/.exec(line);
  if (sep) return { title: strip(sep[1]), text: strip(sep[2]) };
  return { title: strip(line), text: "" };
}

export function parseReleaseNotes(body: string | null | undefined): NoteSection[] {
  const out: NoteSection[] = [];
  let cur: NoteSection | null = null;
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^#{1,4}\s+(.+)$/.exec(line);
    if (head) {
      cur = { title: strip(head[1]), items: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { title: "", items: [] };
      out.push(cur);
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    cur.items.push(parseItem(bullet ? bullet[1] : line));
  }
  return out.filter((s) => s.items.length > 0);
}

/** Les `n` premiers titres de nouveautés (aperçu du toast « mise à jour disponible »). */
export function noteHeadlines(sections: NoteSection[], n: number): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.title)).filter(Boolean).slice(0, n);
}

const parts = (v: string) => v.replace(/^v/i, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);

/** `a` est-elle strictement plus récente que `b` (semver, préfixe « v » toléré) ? */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Version d'origine à afficher dans « Quoi de neuf » après une montée de version ; null au
 *  premier lancement (aucune version vue) ou sans montée. */
export function whatsNewFrom(lastSeen: string | null, current: string): string | null {
  return lastSeen && isNewerVersion(current, lastSeen) ? lastSeen : null;
}
