import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Newspaper, RefreshCw } from "lucide-react";
import { SidePanelLayout } from "../../components/ui/SidePanel";
import { NewsList } from "./components/NewsList";
import { ServerStatusPanel } from "./components/ServerStatusPanel";
import type { NewsItem, RsiServerStatus } from "./types";

/* Actualités (maquette docs/design/maquettes-refonte-pages-2.html, variante A) : articles RSI en
   liste, état des serveurs en fiche fixe à droite. */
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
    <div className="p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Newspaper className="h-6 w-6 text-[var(--accent)]" />
            {t("news.title")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("news.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("news.refresh")}
        </button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("news.loading")}
        </div>
      ) : (
        <SidePanelLayout panel={<ServerStatusPanel status={status} />}>
          <NewsList news={news} />
        </SidePanelLayout>
      )}
    </div>
  );
}
