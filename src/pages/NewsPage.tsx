import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, ExternalLink, Newspaper, Server } from "lucide-react";

/* Onglet Actualités & état des serveurs RSI (inspiré de Stelliverse, réécrit dans la DA
   SCFM). Réutilise les commandes existantes get_rsi_server_status / get_rsi_news. */

type RsiComponent = { name: string; status: string };
type RsiServerStatus = { overall: string; overallLabel: string; components: RsiComponent[] };
type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  category: string | null;
  summary: string | null;
  image: string | null;
};

// Miniature d'article : se masque proprement si l'image manque ou échoue à charger.
function NewsThumb({ src, alt }: { src: string | null; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setOk(false)}
      loading="lazy"
      className="h-16 w-24 shrink-0 rounded-lg border border-white/10 object-cover"
    />
  );
}

// Couleur par code de statut interne (cf. rsi_status.rs).
function statusColor(s: string): string {
  switch (s) {
    case "operational":
      return "#34d399";
    case "degraded":
    case "partial":
      return "#f59e0b";
    case "major":
      return "#ef4444";
    case "maintenance":
      return "#60a5fa";
    default:
      return "#8899aa";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function NewsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RsiServerStatus | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true);
    const [st, nw] = await Promise.all([
      invoke<RsiServerStatus>("get_rsi_server_status").catch(() => null),
      invoke<NewsItem[]>("get_rsi_news", { limit: 20, force }).catch(() => [] as NewsItem[]),
    ]);
    setStatus(st);
    setNews(nw);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void load(false);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Newspaper className="h-6 w-6 text-[var(--accent)]" />
            {t("news.title")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("news.subtitle")}</p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("news.refresh")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("news.loading")}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
          {/* Fil d'actualités */}
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              <Newspaper className="h-3.5 w-3.5" /> {t("news.newsTitle")}
            </h2>
            {news.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-white/40">
                {t("news.empty")}
              </p>
            ) : (
              news.map((n, i) => (
                <button
                  key={`${n.link}-${i}`}
                  onClick={() => void openUrl(n.link)}
                  className="group flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <NewsThumb src={n.image} alt={n.title} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      {n.category && (
                        <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
                          {n.category}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-white/40">{fmtDate(n.pubDate)}</span>
                      <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-white/30 transition-colors group-hover:text-white/60" />
                    </div>
                    <div className="text-[15px] font-semibold leading-snug text-white">{n.title}</div>
                    {n.summary && <p className="line-clamp-2 text-[13px] leading-relaxed text-white/55">{n.summary}</p>}
                  </div>
                </button>
              ))
            )}
          </section>

          {/* État des serveurs */}
          <aside className="sticky top-4 rounded-2xl border border-white/10 bg-[#0a0a0f]/70 p-4 backdrop-blur">
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              <Server className="h-3.5 w-3.5" /> {t("news.serversTitle")}
            </h2>
            {!status ? (
              <p className="text-sm text-white/40">{t("news.statusUnavailable")}</p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: statusColor(status.overall) }} />
                  <span className="text-sm font-semibold text-white">
                    {status.overall !== "unknown"
                      ? t(`dashboard.wRsiStatusOverall.${status.overall}`)
                      : status.overallLabel || t("news.statusUnavailable")}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {status.components.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 border-b border-white/[0.06] py-1.5 last:border-0">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(c.status) }} />
                      <span className="flex-1 truncate text-[13px] text-white/70">{c.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
