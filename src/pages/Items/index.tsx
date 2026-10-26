import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import { ShowMore } from "../../components/ui/ShowMore";
import type { HangarItem } from "./types";
import { groupPacks, packKindCounts, viewPacks, type KindFilter, type Pack } from "./lib/cosmetics";
import { KIND_CHIPS } from "./helpers";
import { PacksTable } from "./components/PacksTable";
import { PackModal } from "./components/PackModal";
import { ItemModal } from "./components/ItemModal";

/* Onglet « Cosmétiques » : packs du hangar RSI en liste filtrable (un pack = une ligne). Un clic
   ouvre la fenêtre du pack avec tous ses objets, ou directement l'objet s'il est seul (choix
   d'André, comme avant la v3.4). Recharge sur `fleet:synced`. */

const STEP = 60;
const chip = "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors";

export default function ItemsCosmeticsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [items, setItems] = useState<HangarItem[]>([]);
  // null = flotte illisible : on n'affiche alors pas la pastille « dans ta flotte ».
  const [fleetNames, setFleetNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [search, setSearch] = usePersistentState("items.search", "");
  const [kind, setKind] = usePersistentState<KindFilter>("items.kindFilter", "all");
  const [limit, setLimit] = useState(STEP);
  const [openId, setOpenId] = useState<number | null>(null);

  // Recharge après une synchronisation RSI (événement émis par Settings).
  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((v) => v + 1));
    return () => {
      void pending.then((un) => un());
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setNoAccount(true);
        return;
      }
      const [rows, ships] = await Promise.all([
        invoke<HangarItem[]>("get_hangar_items", { accountId }),
        invoke<{ name: string }[]>("get_ships", { accountId }).catch(() => null),
      ]);
      setNoAccount(false);
      setItems(rows);
      setFleetNames(ships ? ships.map((s) => s.name) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.key, reloadTick]);

  const packs = useMemo(() => groupPacks(items, (id) => t("items.pledgeFallback", { id })), [items, t]);
  const view = useMemo(() => viewPacks(packs, { q: search, kind }), [packs, search, kind]);
  const counts = useMemo(() => packKindCounts(packs), [packs]);
  useEffect(() => setLimit(STEP), [search, kind]);
  const opened: Pack | null = packs.find((p) => p.id === openId) ?? null;

  if (!loading && noAccount) {
    return (
      <div className="p-8">
        <p className="text-white/50">
          {t("items.noAccount")}{" "}
          <Link to="/" className="text-[var(--accent)] hover:underline">
            {t("items.selectCommander")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("items.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("items.title")}</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("items.loadingItems")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("common.errorPrefix")} {error}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl glass border-dashed border-white/15 p-10 text-center">
          <p className="text-white/70">{t("items.emptyHangar")}</p>
          <Link to="/settings" className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            {t("items.goToSettings")}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[260px] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("items.searchPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-[var(--accent)]/60 focus:outline-none"
              />
            </label>
            <span className="text-[12px] tabular-nums text-white/40">{t("items.countLine", { n: items.length, p: packs.length })}</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {KIND_CHIPS.map(([k, labelKey]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`${chip} ${kind === k ? "border-[var(--accent)]/50 bg-[var(--accent-muted)] text-white" : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"}`}
              >
                {t(labelKey)} <span className="tabular-nums opacity-50">{counts[k]}</span>
              </button>
            ))}
          </div>

          {view.length === 0 ? (
            <p className="text-sm text-white/40">{t("items.noMatch")}</p>
          ) : (
            <div className="glass overflow-x-auto rounded-2xl px-1.5 py-1">
              <PacksTable packs={view.slice(0, limit)} onOpen={(p) => setOpenId(p.id)} />
              <ShowMore rest={view.length - limit} step={STEP} onMore={() => setLimit((l) => l + STEP)} />
            </div>
          )}
        </>
      )}

      {opened &&
        (opened.items.length === 1 ? (
          <ItemModal item={opened.items[0]!} fleetNames={fleetNames} onClose={() => setOpenId(null)} />
        ) : (
          <PackModal pack={opened} fleetNames={fleetNames} onClose={() => setOpenId(null)} />
        ))}
    </div>
  );
}
