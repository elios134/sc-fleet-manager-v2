import type { SectionKey } from "../sections";
import type { Tone } from "../status";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-400 shadow-[0_0_8px_#34d399]",
  warn: "bg-[var(--amber)] shadow-[0_0_8px_var(--amber)]",
  off: "bg-white/35",
};

export type StatusItem = { key: SectionKey; title: string; detail: string; tone: Tone };

/** Bandeau d'état : une pastille en verre par domaine, cliquable vers sa section. */
export function StatusStrip({ items, onOpen }: { items: StatusItem[]; onOpen: (k: SectionKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2 lg:ml-auto">
      {items.map((it) => (
        <button
          key={it.key + it.title}
          type="button"
          onClick={() => onOpen(it.key)}
          className="glass flex items-center gap-2 rounded-xl px-3 py-[7px] text-xs hover:brightness-110"
        >
          <i className={`h-2 w-2 rounded-full ${DOT[it.tone]}`} />
          <b className="font-bold text-white">{it.title}</b>
          <span className="text-white/50">· {it.detail}</span>
        </button>
      ))}
    </div>
  );
}
