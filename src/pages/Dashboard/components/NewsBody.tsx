import { type TFunction } from "i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type NewsItem } from "../types";

/* ── Actualités RSI : liste cliquable ouvrant le comm-link (Phase 0) ── */

function NewsBody({
  items,
  t,
  editing,
}: {
  items: NewsItem[];
  t: TFunction;
  editing: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wNewsNone")}
      </div>
    );
  }
  return (
    <div>
      {items.slice(0, 5).map((n) => (
        <div
          key={n.link}
          onClick={editing ? undefined : () => void openUrl(n.link).catch(() => {})}
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="truncate text-[13px] font-medium text-white">{n.title}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/40">
              {n.category ?? "Comm-Link"}
            </span>
            {n.pubDate && (
              <span className="shrink-0 text-[10px] text-white/30">
                {formatNewsDate(n.pubDate)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Date RSS (RFC-822) → court format local. Repli : chaîne brute si non parsable.
function formatNewsDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export { NewsBody };
