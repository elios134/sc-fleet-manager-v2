import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import Dropdown from "../../../components/ui/Dropdown";
import { ScopeWithRanks, mapRewardScopeToScopeName, ScopeProgress, computeCurrentRank } from "../helpers";

/* ─────────────────────────── Modal détail ─────────────────────────── */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
        {title}
      </h3>
      {children}
    </section>
  );
}

/* ─────────────────── Panneau Réputation (factorisé) ───────────────────
   Machine à états Scope/Rank réutilisée par le modal de détail ET les cartes
   de l'onglet Objectifs (mission→scope via rewardScope + SCOPE_NAME_MAP, jamais
   la FK scopeId qui n'est pas peuplée). Réputation saisie à la main, persistée
   par compte + par scope (set_scope_progress) — donc partagée entre le détail et
   l'onglet pour un même scope. */
export function ReputationPanel({
  rewardScope,
  accountId,
  scopes,
  noScopeLabel,
  onReputation,
}: {
  rewardScope: string | null;
  accountId: string;
  scopes: ScopeWithRanks[];
  noScopeLabel?: string;
  // Remonte la réputation déclarée (null = non déclarée / inconnue) à chaque (re)chargement
  // ou enregistrement. Sert au prérequis de la carte Objectif (Lot 2). Le modal n'en a pas besoin.
  onReputation?: (rep: number | null) => void;
}) {
  const { t } = useTranslation();
  const noScopeText = noScopeLabel ?? t("mission.noScopeForMission");
  const scopeName = mapRewardScopeToScopeName(rewardScope);
  const scope = scopeName ? scopes.find((s) => s.scopeName === scopeName) ?? null : null;
  // undefined = chargement ; null = non déclarée ; objet = déclarée.
  const [repProgress, setRepProgress] = useState<ScopeProgress | null | undefined>(undefined);
  const [repEditing, setRepEditing] = useState(false);
  const [repRankId, setRepRankId] = useState("");
  const [repXP, setRepXP] = useState(0);
  const [repSaving, setRepSaving] = useState(false);

  useEffect(() => {
    if (!scope) {
      setRepProgress(null);
      return;
    }
    let cancelled = false;
    setRepProgress(undefined);
    setRepEditing(false);
    invoke<ScopeProgress | null>("get_scope_progress", { accountId, scopeId: scope.id })
      .then((p) => {
        if (!cancelled) setRepProgress(p);
      })
      .catch(() => {
        if (!cancelled) setRepProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scope?.id, accountId]);

  const rankComp = useMemo(
    () => (repProgress && scope ? computeCurrentRank(repProgress.currentReputation, scope.ranks) : null),
    [repProgress, scope],
  );

  // Remonte la réputation déclarée au parent (carte Objectif) dès qu'elle change.
  // undefined (chargement) → on ne remonte rien encore ; null (non déclarée) → null.
  useEffect(() => {
    if (repProgress === undefined) return;
    onReputation?.(repProgress ? repProgress.currentReputation : null);
  }, [repProgress, onReputation]);

  // Rangs sélectionnables : on exclut les rangs négatifs (Hostile), triés par rankIndex.
  const selectableRanks = useMemo(
    () =>
      scope
        ? [...scope.ranks].filter((r) => r.minReputation >= 0).sort((a, b) => a.rankIndex - b.rankIndex)
        : [],
    [scope],
  );
  const selIdx = selectableRanks.findIndex((r) => r.id === repRankId);
  const selRank = selIdx >= 0 ? selectableRanks[selIdx] : null;
  const nextSelRank = selIdx >= 0 ? selectableRanks[selIdx + 1] ?? null : null;
  // Étendue d'XP dans le rang = seuil du rang suivant − seuil du rang choisi. null au dernier rang.
  const maxXP = selRank && nextSelRank ? nextSelRank.minReputation - selRank.minReputation : null;

  // Ouvre l'édition en pré-remplissant le rang + la position dans le rang depuis la progression courante.
  function startEditing() {
    if (repProgress && rankComp?.currentRank) {
      const cur = rankComp.currentRank;
      setRepRankId(cur.id);
      setRepXP(Math.max(0, repProgress.currentReputation - cur.minReputation));
    } else {
      setRepRankId(selectableRanks[0]?.id ?? "");
      setRepXP(0);
    }
    setRepEditing(true);
  }

  async function saveRep() {
    if (!scope || !selRank) return;
    // Rep totale stockée = seuil du rang choisi + position dans le rang (0 au dernier rang).
    const total = selRank.minReputation + (maxXP != null ? Math.min(repXP, maxXP) : 0);
    setRepSaving(true);
    try {
      const p = await invoke<ScopeProgress>("set_scope_progress", {
        accountId,
        scopeId: scope.id,
        currentReputation: total,
      });
      setRepProgress(p);
      setRepEditing(false);
    } catch {
      /* ignore */
    } finally {
      setRepSaving(false);
    }
  }

  if (!scope) {
    return <p className="text-sm italic text-white/40">{noScopeText}</p>;
  }
  if (repProgress === undefined) {
    return <p className="text-sm text-white/40">…</p>;
  }
  if (repEditing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-wider text-white/40">{t("mission.rank")}</label>
          <Dropdown
            value={repRankId}
            onChange={(v) => {
              setRepRankId(v);
              setRepXP(0);
            }}
            ariaLabel={t("mission.rank")}
            options={selectableRanks.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>

        {maxXP != null ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label className="text-[11px] uppercase tracking-wider text-white/40">
                {t("mission.rankProgress")}
              </label>
              <span className="text-[11px] tabular-nums text-white/70">
                {t("mission.rankXp", {
                  current: Math.min(repXP, maxXP).toLocaleString("fr-FR"),
                  max: maxXP.toLocaleString("fr-FR"),
                })}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxXP}
              step={1}
              value={Math.min(repXP, maxXP)}
              onChange={(e) => setRepXP(parseInt(e.target.value, 10))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        ) : (
          <p className="text-[11px] italic text-white/40">
            {t("mission.rankMaxNoProgress")}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void saveRep()}
            disabled={repSaving || !selRank}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)" }}
          >
            {repSaving ? "…" : t("mission.ok")}
          </button>
          <button
            onClick={() => setRepEditing(false)}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-white/50 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }
  if (repProgress === null) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm italic text-white/40">{t("missionIntel.repUndeclared")}</span>
        <button
          onClick={startEditing}
          className="rounded-full border border-dashed border-white/25 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/60 transition-colors hover:border-accent/50 hover:text-accent"
        >
          {t("mission.declare")}
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={startEditing}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]"
      >
        <span className="font-semibold" style={{ color: "var(--accent)" }}>
          {rankComp?.currentRank?.name ?? "—"}
        </span>
        <span className="text-white/30">·</span>
        <span className="tabular-nums text-white/80">
          {t("mission.repValue", { rep: repProgress.currentReputation.toLocaleString("fr-FR") })}
        </span>
        <span className="ml-auto text-white/40">✎</span>
      </button>
      {rankComp && (
        <div className="mt-2">
          <div className="mb-1.5 text-[11px] text-white/50">
            {rankComp.nextRank ? (
              <>
                {rankComp.currentRank?.name} → {rankComp.nextRank.name} ·{" "}
                <strong className="text-white/80">
                  {t("mission.repRemaining", { rep: rankComp.repToNextRank.toLocaleString("fr-FR") })}
                </strong>
              </>
            ) : (
              <span style={{ color: "#34d399" }}>{t("mission.rankMaxReached")}</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${rankComp.progressPercent}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      )}
    </>
  );
}
