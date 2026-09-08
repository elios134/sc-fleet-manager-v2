import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Star, Target, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import StatCard from "../components/ui/StatCard";
import Dropdown from "../components/ui/Dropdown";
import {
  deriveStarRating,
  renderStars,
  formatRewardRange,
  calculateUecPerHour,
  formatUecPerHourCompact,
} from "../lib/missionStats";

export { StatCard };

/* ── Types (identiques à la V1 MissionListItem) ── */

export type MissionListItem = {
  uuid: string;
  title: string;
  description: string | null;
  factionName: string | null;
  factionUuid: string | null;
  factionType: string | null;
  rewardScope: string | null;
  illegal: boolean;
  legalityLabel: string | null;
  hasBlueprints: boolean;
  blueprintDropChance: number | null;
  rewardMin: number | null;
  rewardMax: number | null;
  rewardCurrency: string | null;
  timeMins: number | null;
  shareable: boolean;
  hasCombat: boolean;
  hasHauling: boolean;
  hasDefend: boolean;
  minStandingName: string | null;
  minStandingValue: number | null;
  maxStandingName: string | null;
  maxStandingValue: number | null;
  released: boolean;
  workInProgress: boolean;
  notForRelease: boolean;
  starSystems: string | null;
  reputationGained: string | null;
  cooldownJson: string | null;
  reputationAmount: number | null;
  gameVersion: string | null;
  webUrl: string | null;
  source: string;
  blueprints: Array<{ name: string; itemUuid: string }>;
};

export type ObjectiveItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  minStandingName: string | null;
  minStandingValue: number | null;
  status: string | null;
  notes: string | null;
  updatedAt: string | null;
};

export type FavoriteItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  note: string | null;
  createdAt: string | null;
};


/* ── Helpers visuels (réplique missionHelpers.ts V1) ── */

type ScopeFamily = "combat" | "cargo" | "hauling" | "recovery" | "salvage" | "other";

// Couleurs par famille (codes V1 adaptés au thème V2 : combat=rouge, cargo/hauling=or,
// recovery=bleu, salvage/other=neutre).
export const FAMILY: Record<ScopeFamily, { color: string; bg: string; border: string }> = {
  combat: { color: "#f87171", bg: "rgba(248,113,113,0.14)", border: "rgba(248,113,113,0.30)" },
  cargo: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  hauling: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  recovery: { color: "#60a5fa", bg: "rgba(96,165,250,0.14)", border: "rgba(96,165,250,0.30)" },
  salvage: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
  other: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
};

export function mapScopeFamily(m: MissionListItem): ScopeFamily {
  const s = (m.rewardScope ?? "").toLowerCase();
  if (
    m.hasCombat || s.includes("combat") || s.includes("assassin") || s.includes("bounty") ||
    s.includes("patrol") || s.includes("elimin") || s.includes("murder") || s.includes("hunt")
  )
    return "combat";
  if (s.includes("salvage")) return "salvage";
  if (s.includes("recovery") || s.includes("rescue") || s.includes("retrieval")) return "recovery";
  if (m.hasHauling || s.includes("hauling")) return "hauling";
  if (s.includes("cargo") || s.includes("delivery") || s.includes("transport")) return "cargo";
  return "other";
}

export function scopeIcon(scope: string | null): string {
  if (!scope) return "◇";
  const s = scope.toLowerCase();
  if (s.includes("assassin") || s.includes("elimin") || s.includes("murder")) return "◆";
  if (s.includes("delivery") || s.includes("cargo") || s.includes("transport")) return "▷";
  if (s.includes("bounty") || s.includes("patrol")) return "◈";
  if (s.includes("salvage")) return "⟁";
  return "◇";
}

export function deriveTierLabel(v: number | null, t: (key: string) => string): string {
  switch (deriveStarRating(v)) {
    case 1: return t("mission.tier.beginner");
    case 2: return t("mission.tier.accessible");
    case 3: return t("mission.tier.standard");
    case 4: return t("mission.tier.advanced");
    default: return t("mission.tier.high");
  }
}

// Ré-export pour Dashboard/MissionHub (définitions dans lib/missionStats, importées ci-dessus).
export { deriveStarRating, renderStars, formatRewardRange, calculateUecPerHour, formatUecPerHourCompact };

// Masque les descriptions à template dynamique non résolu (~mission(...), etc.).
export function isCleanDescription(d: string | null): boolean {
  if (!d) return false;
  return !/~(?:mission_giver|mission|ship|location|item)\(/.test(d);
}

/* ── Scope / Rank (réputation) ── */

type Rank = {
  id: string;
  scopeId: string;
  name: string;
  nameKey: string;
  minReputation: number;
  rangeXP: number | null;
  rankIndex: number;
};
export type ScopeWithRanks = { id: string; scopeName: string; displayName: string; ranks: Rank[] };
type ScopeProgress = {
  id: number;
  accountId: string;
  scopeId: string;
  currentReputation: number;
  declaredAt: string;
  updatedAt: string;
};

// Mapping mission.rewardScope → scopeName interne (réplique scopeMapping.ts V1).
const SCOPE_NAME_MAP: Record<string, string | null> = {
  Assassination: "Assassination",
  "Bounty Hunter": "BountyHunter",
  "Bounty Hunters Guild": "BountyHunter_BountyHuntersGuild",
  Cargo: null,
  "Cargo Transport": null,
  Combat: "ShipCombat_HeadHunters",
  "Combat Assist": "ShipCombat_HeadHunters",
  Delivery: null,
  Hauling: "Hauling",
  Medical: null,
  Mining: null,
  Security: "Security",
  Transport: "Hauling",
  Recovery: null,
  Salvage: null,
  Wikelo: "Wikelo",
};

export function mapRewardScopeToScopeName(rewardScope: string | null): string | null {
  if (!rewardScope) return "FactionReputation";
  return SCOPE_NAME_MAP[rewardScope] ?? null;
}

type RankComputation = {
  currentRank: Rank | null;
  nextRank: Rank | null;
  progressPercent: number;
  repToNextRank: number;
};

// Réplique fidèle de computeCurrentRank V1 (missionHelpers.ts).
function computeCurrentRank(currentReputation: number, ranks: Rank[]): RankComputation {
  if (ranks.length === 0) {
    return { currentRank: null, nextRank: null, progressPercent: 0, repToNextRank: 0 };
  }
  const sorted = [...ranks].sort((a, b) => a.rankIndex - b.rankIndex);
  let currentRank: Rank | null = sorted[0] ?? null;
  let nextRank: Rank | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r && currentReputation >= r.minReputation) {
      currentRank = r;
      nextRank = sorted[i + 1] ?? null;
    }
  }
  if (!nextRank) {
    return { currentRank, nextRank: null, progressPercent: 100, repToNextRank: 0 };
  }
  const rangeInRank = nextRank.minReputation - (currentRank?.minReputation ?? 0);
  const repInRank = currentReputation - (currentRank?.minReputation ?? 0);
  const progressPercent =
    rangeInRank > 0 ? Math.min(100, Math.round((repInRank / rangeInRank) * 100)) : 0;
  return {
    currentRank,
    nextRank,
    progressPercent,
    repToNextRank: nextRank.minReputation - currentReputation,
  };
}

/* ── Reco de farm (port fidèle de missionHelpers.ts V1) ── */

// Meilleure mission à farmer : parmi les missions publiées de la MÊME faction avec
// reputationAmount>0 et timeMins>0, celle au plus haut ratio réputation/minute.
export function findOptimalMission(
  allMissions: MissionListItem[],
  factionUuid: string | null,
): MissionListItem | null {
  if (!factionUuid) return null;
  const candidates = allMissions.filter(
    (m) =>
      m.released &&
      m.factionUuid === factionUuid &&
      m.reputationAmount != null &&
      m.reputationAmount > 0 &&
      m.timeMins != null &&
      m.timeMins > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) => {
    const bRate = (best.reputationAmount ?? 0) / (best.timeMins ?? Infinity);
    const mRate = (m.reputationAmount ?? 0) / (m.timeMins ?? Infinity);
    return mRate > bRate ? m : best;
  });
}

// Nombre de runs pour combler la réputation manquante (0 si déjà atteint, ∞ si rep/run≤0).
export function computeRepeatsNeeded(target: number, current: number, perRun: number): number {
  if (current >= target) return 0;
  if (perRun <= 0) return Infinity;
  return Math.ceil((target - current) / perRun);
}

// Temps total de farm en minutes (runs × durée d'un run).
export function computeTotalFarmTime(repeats: number, durMinsPerRun: number): number {
  if (repeats === 0) return 0;
  return repeats * durMinsPerRun;
}


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

export function MissionModal({
  mission,
  scopes,
  accountId,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  onClose,
}: {
  mission: MissionListItem;
  scopes: ScopeWithRanks[];
  accountId: string;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const subtitleParts: string[] = [];
  if (mission.factionName) subtitleParts.push(mission.factionName);
  subtitleParts.push(deriveTierLabel(mission.minStandingValue, t));
  const subtitle = subtitleParts.join(" · ");

  const uecPerHour = calculateUecPerHour(mission);
  const showDesc = isCleanDescription(mission.description);
  const wikiUrl = mission.webUrl ?? `https://star-citizen.wiki/Mission/${mission.uuid}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(16,18,24,0.95)", borderColor: "color-mix(in oklab, var(--accent) 18%, transparent)" }}
      >
        {/* En-tête */}
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">{mission.title}</h2>
            <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Statistiques */}
        <Section title={t("mission.statistics")}>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label={t("mission.reward")} value={formatRewardRange(mission)} caption={t("mission.auec")} variant="gold" />
            <StatCard
              label={t("mission.repXp")}
              value={mission.reputationAmount != null ? mission.reputationAmount.toLocaleString("fr-FR") : "—"}
              caption={t("mission.perRun")}
            />
            <StatCard
              label={t("mission.efficiency")}
              value={formatUecPerHourCompact(uecPerHour)}
              caption={t("mission.auecPerHour")}
              variant={uecPerHour != null ? "gold" : "neutral"}
            />
          </div>
        </Section>

        {/* Prérequis */}
        <Section title={t("mission.prereq")}>
          {mission.minStandingName && mission.minStandingValue ? (
            <div className="flex items-center gap-2 text-sm text-white/80">
              <span>🔒</span>
              <span>
                {mission.factionName ? `${mission.factionName} : ` : ""}
                <strong className="text-white">{mission.minStandingName}</strong> (
                {t("mission.repParen", { rep: mission.minStandingValue.toLocaleString("fr-FR") })})
              </span>
            </div>
          ) : (
            <p className="text-sm italic text-white/40">{t("mission.noPrereq")}</p>
          )}
        </Section>

        {/* Réputation — panneau factorisé (machine à états Scope/Rank) */}
        <Section title={t("mission.reputation")}>
          <ReputationPanel rewardScope={mission.rewardScope} accountId={accountId} scopes={scopes} />
        </Section>

        {/* Drops possibles */}
        {mission.hasBlueprints && mission.blueprints.length > 0 && (
          <Section title={t("mission.drops")}>
            <ul className="flex flex-col gap-1">
              {mission.blueprints.map((b) => (
                <li key={b.itemUuid} className="flex items-center gap-2 text-sm text-white/75">
                  <span style={{ color: "var(--accent)" }}>◆</span>
                  {b.name}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Description */}
        {showDesc && (
          <Section title={t("mission.description")}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
              {mission.description}
            </p>
          </Section>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={onToggleObjective}
            className={[
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              isObjective
                ? "border text-[#60a5fa]"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            ].join(" ")}
            style={isObjective ? { borderColor: "rgba(96,165,250,0.35)", background: "rgba(96,165,250,0.12)" } : undefined}
          >
            <Target className="h-4 w-4" />
            {isObjective ? t("mission.objectiveTracked") : t("mission.addObjective")}
          </button>
          <button
            onClick={onToggleFavorite}
            className={[
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              isFavorite
                ? "border text-accent"
                : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
            ].join(" ")}
            style={isFavorite ? { borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)" } : undefined}
          >
            <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
            {t("mission.favorite")}
          </button>
          <button
            onClick={() => void openUrl(wikiUrl)}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
          >
            {t("mission.viewWiki")}
          </button>
        </div>
      </div>
    </div>
  );
}
