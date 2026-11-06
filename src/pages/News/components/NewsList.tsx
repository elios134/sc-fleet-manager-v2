import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { appLocale } from "../../../lib/format";
import { fmtNewsDate } from "../lib/news";
import type { NewsItem } from "../types";

/** Image d'article : se masque si elle manque ou ne charge pas. */
function NewsThumb({ src }: { src: string | null }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return <img src={src} alt="" onError={() => setOk(false)} loading="lazy" className="aspect-video w-40 shrink-0 rounded-xl border border-white/10 object-cover" />;
}

/** Articles RSI : image, catégorie, date, titre, résumé. Clic → l'article sur le site de RSI. */
export function NewsList({ news }: { news: NewsItem[] }) {
  const { t } = useTranslation();
  if (news.length === 0) return <p className="glass rounded-2xl px-4 py-6 text-center text-sm text-white/40">{t("news.empty")}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {news.map((n) => (
        <button
          key={n.link}
          type="button"
          onClick={() => void openUrl(n.link)}
          className="glass group flex flex-wrap items-start gap-3.5 rounded-2xl p-3.5 text-left transition-colors hover:border-white/25"
        >
          <NewsThumb src={n.image} />
          <span className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              {n.category && <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 py-0.5 text-[10.5px] text-white">{n.category}</span>}
              <span className="text-[11.5px] text-white/45">{fmtNewsDate(n.pubDate, appLocale())}</span>
            </span>
            <span className="text-[15px] font-semibold leading-snug text-white">{n.title}</span>
            {n.summary && <span className="line-clamp-2 text-[12.5px] leading-relaxed text-white/55">{n.summary}</span>}
            <span className="inline-flex items-center gap-1 text-[11.5px] text-white/45 group-hover:text-white/75">
              {t("news.readOnRsi")} <ExternalLink className="h-3 w-3" />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
