import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { type CraftingHubBlueprintItem, type CraftingStats, type OwnedFilter, type SearchMode, type Family } from "../types";
import { FAMILY_ORDER, KNOWN_SHIP_COMPONENT_TYPES, familyOf, suggestBlueprint } from "../helpers";

// État et logique du Crafting Hub : catalogue, filtres, recherche, sélection, statistiques.
export function useCraftingHub() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CraftingHubBlueprintItem[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<CraftingStats | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  // Recherche/filtres/sélection persistants → retrouvés en revenant sur la page (la navigation
  // démonte la page sinon tout est réinitialisé). currentPage reste transitoire (repart à 1).
  const [search, setSearch] = usePersistentState("crafting.search", "");
  const [searchMode, setSearchMode] = usePersistentState<SearchMode>("crafting.searchMode", "name");
  const [ownedFilter, setOwnedFilter] = usePersistentState<OwnedFilter>("crafting.owned", "all");
  // Catégorie ouverte dans la liste : null = on affiche la LISTE DES CATÉGORIES ; sinon, tous
  // les items de cette famille (plus de pagination).
  const [openFamily, setOpenFamily] = usePersistentState<Family | null>("crafting.openFamily", null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = usePersistentState<string | null>("crafting.selected", null);
  // Re-cochage depuis Game.log : état + récap affiché.
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);
  // Noms de log non appariés (mapping manuel) + valeur saisie par ligne.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});

  // Pré-sélection d'un blueprint à l'arrivée (ex. depuis l'onglet Drop du Mission Hub).
  const location = useLocation();
  useEffect(() => {
    const st = location.state as { blueprintId?: string } | null;
    if (st && typeof st.blueprintId === "string") setSelectedId(st.blueprintId);
  }, [location.state]);

  // ── Mount ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [blueprints, statsData, owned] = await Promise.all([
          invoke<CraftingHubBlueprintItem[]>("list_blueprints"),
          invoke<CraftingStats>("get_crafting_stats"),
          invoke<string[]>("list_blueprint_owned", { accountId: acc }),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setItems(blueprints);
        setStats(statsData);
        setOwnedIds(new Set(owned));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-coche les blueprints débloqués en jeu (lecture Game.log), puis recharge les possédés.
  type ResyncRecap = {
    logFound: boolean;
    detected: number;
    alreadyOwned: number;
    newlyChecked: number;
    ambiguousSkipped: number;
    unmatched: number;
    unmatchedNames: string[];
  };
  async function handleResync() {
    if (resyncing || !accountId) return;
    setResyncing(true);
    setResyncMsg(null);
    try {
      const r = await invoke<ResyncRecap>("resync_blueprints_from_log", { accountId });
      if (!r.logFound) {
        setResyncMsg(t("crafting.resyncLogNotFound"));
        setUnmatched([]);
      } else if (r.detected === 0) {
        setResyncMsg(t("crafting.resyncNoneDetected"));
        setUnmatched([]);
      } else {
        // Recharge les possédés (la map a pu changer).
        const owned = await invoke<string[]>("list_blueprint_owned", { accountId });
        setOwnedIds(new Set(owned));
        const extra =
          r.unmatched > 0 ? t("crafting.resyncUnmatched", { count: r.unmatched }) : "";
        setResyncMsg(
          t("crafting.resyncDetected", {
            detected: r.detected,
            newlyChecked: r.newlyChecked,
            alreadyOwned: r.alreadyOwned,
            extra,
          }),
        );
        // Surface les non-appariés + pré-remplit chaque ligne avec le blueprint le
        // plus probable (similarité) → l'utilisateur n'a qu'à confirmer.
        const names = r.unmatchedNames ?? [];
        setUnmatched(names);
        const prefill: Record<string, string> = {};
        for (const n of names) {
          const bp = suggestBlueprint(n, items);
          if (bp) prefill[n] = bp.displayName;
        }
        setAliasInputs(prefill);
      }
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResyncing(false);
    }
  }

  // Associe un nom de log non apparié au blueprint choisi (persiste + coche).
  async function mapAlias(logName: string) {
    const typed = (aliasInputs[logName] ?? "").trim();
    if (!typed || !accountId) return;
    const bp = items.find((it) => it.displayName === typed);
    if (!bp) {
      setResyncMsg(t("crafting.unmatchedNoBp"));
      return;
    }
    try {
      await invoke("set_blueprint_log_alias", { accountId, logName, blueprintId: bp.id });
      setOwnedIds((prev) => new Set(prev).add(bp.id));
      setUnmatched((prev) => prev.filter((n) => n !== logName));
      setAliasInputs((p) => {
        const next = { ...p };
        delete next[logName];
        return next;
      });
    } catch (err) {
      setResyncMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleOwned(blueprintId: string) {
    if (!accountId) return;
    try {
      const res = await invoke<{ owned: boolean }>("toggle_blueprint_owned", {
        accountId,
        blueprintId,
      });
      setOwnedIds((prev) => {
        const next = new Set(prev);
        if (res.owned) next.add(blueprintId);
        else next.delete(blueprintId);
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  // ── Familles FR groupées (dérivées de output.type), avec compteurs ──
  const familyData = useMemo(() => {
    const counts = new Map<Family, number>();
    const unmapped = new Set<string>();
    for (const it of items) {
      const fam = familyOf(it.category);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
      // Signale les types vaisseau non répertoriés (rangés par défaut dans Composants).
      if (fam === "Composants vaisseau" && !KNOWN_SHIP_COMPONENT_TYPES.has(it.category)) {
        unmapped.add(it.category);
      }
    }
    const families = FAMILY_ORDER.filter((f) => (counts.get(f) ?? 0) > 0);
    return { counts, families, unmapped };
  }, [items]);

  // Signale en console (une fois) les types non mappés explicitement → famille par défaut.
  useEffect(() => {
    if (familyData.unmapped.size > 0) {
      console.warn(
        "[CraftingHub] types non répertoriés → Composants vaisseau :",
        [...familyData.unmapped],
      );
    }
  }, [familyData]);

  // ── Filtres client ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (ownedFilter === "owned" && !ownedIds.has(it.id)) return false;
      if (ownedFilter === "remaining" && ownedIds.has(it.id)) return false;
      if (q.length > 0) {
        // Mode NOM : nom du blueprint/objet produit. Mode INGRÉDIENT : matériau de la recette
        // (« iron » → tous les crafts qui contiennent de l'iron). Toggle Nom/Matériau au-dessus.
        const match =
          searchMode === "ingredient"
            ? (it.ingredientNames ?? []).some((n) => n.toLowerCase().includes(q))
            : `${it.displayName} ${it.producedItemName ?? ""}`.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [items, search, searchMode, ownedFilter, ownedIds]);

  // Recherche active → on court-circuite le drill-down par catégorie et on liste à plat les
  // résultats (toutes familles). Sinon : catégorie ouverte → ses items ; aucune → liste des
  // catégories. Plus de pagination : tout défile.
  const searching = search.trim().length > 0;
  const familyItems = openFamily
    ? filtered.filter((it) => familyOf(it.category) === openFamily)
    : [];

  const total = stats?.total ?? 0;

  return {
    t,
    items,
    setItems,
    ownedIds,
    setOwnedIds,
    stats,
    setStats,
    accountId,
    setAccountId,
    search,
    setSearch,
    searchMode,
    setSearchMode,
    ownedFilter,
    setOwnedFilter,
    openFamily,
    setOpenFamily,
    loading,
    setLoading,
    error,
    setError,
    selectedId,
    setSelectedId,
    resyncing,
    setResyncing,
    resyncMsg,
    setResyncMsg,
    unmatched,
    setUnmatched,
    aliasInputs,
    setAliasInputs,
    location,
    handleResync,
    mapAlias,
    toggleOwned,
    familyData,
    filtered,
    searching,
    familyItems,
    total,
  };
}
