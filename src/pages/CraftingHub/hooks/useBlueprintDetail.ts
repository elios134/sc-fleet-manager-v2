import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { type BlueprintStat } from "../../../lib/craftingStats";
import { type BlueprintDetail, type Dismantle } from "../types";

// Cache mémoire du démantèlement par blueprint : une seule requête Wiki par objet
// pour toute la durée de vie de la session (l'onglet Recyclage n'appelle plus le réseau
// à chaque réouverture).
const dismantleCache = new Map<string, Dismantle>();

// État et chargement de la fiche d'un plan : détail, qualité par emplacement, onglet, recyclage.
export function useBlueprintDetail({
  blueprintId,
  accountId,
}: {
  blueprintId: string;
  accountId: string;
  isOwned: boolean;
  onToggleOwned: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ingrédient dont on affiche les localisations de minage (modale « où miner »).
  const [miningIngredient, setMiningIngredient] = useState<{ ref: string; name: string } | null>(
    null,
  );
  // Qualité PARTAGÉE par slot (clé = slotName brut, ex. « FRAME »). Vide → défaut 500/initial.
  // Pilote les curseurs des cartes ET le recalcul live des stats agrégées (computeStackedStatValue).
  const [qualityBySlot, setQualityBySlot] = useState<Record<string, number>>({});
  // Onglet actif de la fiche (Détails / Craft / Mission / Recyclage) — persistant.
  const [tab, setTab] = usePersistentState<"object" | "craft" | "mission" | "recycle">(
    "crafting.detailTab",
    "object",
  );
  // Recyclage : chargé paresseusement à l'ouverture de l'onglet, mis en cache par blueprint.
  const [dismantle, setDismantle] = useState<Dismantle>(null);
  const [dismantleLoading, setDismantleLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQualityBySlot({}); // réinitialise au changement de blueprint
    setDismantle(dismantleCache.get(blueprintId) ?? null); // valeur en cache si déjà chargée
    invoke<BlueprintDetail | null>("get_blueprint_detail", { blueprintId, accountId })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, accountId]);

  // Fetch paresseux du recyclage : uniquement quand l'onglet Recyclage est ouvert et
  // que ce blueprint n'est pas déjà en cache (une requête Wiki max par objet/session).
  useEffect(() => {
    if (tab !== "recycle" || dismantleCache.has(blueprintId)) return;
    let cancelled = false;
    setDismantleLoading(true);
    invoke<Dismantle>("get_blueprint_dismantle", { blueprintId })
      .then((d) => {
        dismantleCache.set(blueprintId, d ?? null);
        if (!cancelled) setDismantle(d ?? null);
      })
      .catch(() => {
        if (!cancelled) setDismantle(null);
      })
      .finally(() => {
        if (!cancelled) setDismantleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, blueprintId]);

  const it = detail?.itemDetails ?? null;

  // Stats réactives : regroupées par gpp (1 carte) ; slots distincts (1 slider).
  const stats = useMemo(() => (detail?.stats ?? []) as BlueprintStat[], [detail]);
  const statGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BlueprintStat[]>();
    for (const s of stats) {
      if (!map.has(s.gpp)) {
        map.set(s.gpp, []);
        order.push(s.gpp);
      }
      map.get(s.gpp)!.push(s);
    }
    return order.map((gpp) => ({ gpp, label: map.get(gpp)![0]!.statNameLocKey, entries: map.get(gpp)! }));
  }, [stats]);

  // Axes de qualité (onglet Détails) : labels distincts des modifiers de tous les slots
  // (les MÊMES que le simulateur Craft) + labels de stats lisibles (hors clés LOC « @… »).
  const craftAxes = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; betterWhen: string | null }> = [];
    const add = (l: string | null | undefined, betterWhen: string | null) => {
      const v = l?.trim();
      if (v && !v.startsWith("@") && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        out.push({ label: v, betterWhen });
      }
    };
    for (const ing of detail?.ingredients ?? []) {
      for (const m of ing.modifiers ?? []) add(m.label, m.better_when ?? null);
    }
    for (const g of statGroups) add(g.label, null); // stats sans sens « bon » connu
    return out;
  }, [detail, statGroups]);

  // Systèmes agrégés des missions liées (starSystems = chaîne « Nyx, Pyro, Stanton »).
  const linkedSystems = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of detail?.linkedMissions ?? []) {
      for (const s of (m.starSystems ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
    }
    return out;
  }, [detail]);

  return {
    t,
    detail,
    setDetail,
    loading,
    setLoading,
    error,
    setError,
    miningIngredient,
    setMiningIngredient,
    qualityBySlot,
    setQualityBySlot,
    tab,
    setTab,
    dismantle,
    setDismantle,
    dismantleLoading,
    setDismantleLoading,
    it,
    stats,
    statGroups,
    craftAxes,
    linkedSystems,
  };
}

export type BlueprintDetailState = ReturnType<typeof useBlueprintDetail> & {
  blueprintId: string;
  accountId: string;
  isOwned: boolean;
  onToggleOwned: () => void;
};
