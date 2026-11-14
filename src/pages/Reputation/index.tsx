// Onglet Réputation du hub Missions (maquette docs/design/maquette-reprendre-reputation.html,
// variante A) : factions à gauche, fiche à droite. Tout vient du Game.log et du wiki (Rust :
// commands/reputation) ; seul le rang corrigé à la main est enregistré.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Loader2, Medal } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { usePersistentState } from "../../lib/uiPersist";
import { factionKey } from "../../lib/reputation";
import type { ReputationOverview } from "../../lib/reputation";
import { FactionList } from "./components/FactionList";
import { FactionHero } from "./components/FactionHero";
import { RepTables } from "./components/RepTables";
import { CorrectRankModal } from "./components/CorrectRankModal";

export default function ReputationPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<ReputationOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = usePersistentState<string>("reputation.selected", "");
  const [correcting, setCorrecting] = useState(false);

  const load = useCallback(() => {
    invoke<ReputationOverview>("get_reputation_overview")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Recharge à chaque fin de mission lue dans le Game.log.
  useEffect(() => {
    load();
    const un = listen<{ kind: string }>("gamelog:event", (e) => {
      if (e.payload.kind === "mission") load();
    });
    return () => void un.then((f) => f());
  }, [load]);

  const factions = useMemo(() => data?.factions ?? [], [data]);
  const current = factions.find((f) => factionKey(f) === selected) ?? factions[0];

  if (error) return <p className="m-6 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">{error}</p>;
  if (!data)
    return (
      <div className="flex h-full items-center justify-center text-white/40">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  if (!current)
    return (
      <div className="mx-auto max-w-xl p-6">
        <EmptyState icon={Medal} title={t("reputation.emptyTitle")} text={t("reputation.emptyText")} />
      </div>
    );

  const save = async (rankIndex: number, repInRank: number) => {
    await invoke("set_faction_rank", { faction: current.faction, scopeId: current.scopeId, rankIndex, repInRank });
    load();
  };
  const reset = async () => {
    await invoke("clear_faction_rank", { faction: current.faction, scopeId: current.scopeId });
    load();
  };

  return (
    <div className="h-full overflow-y-auto px-6 pb-28 pt-4">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <FactionList factions={factions} selected={factionKey(current)} onSelect={setSelected} />
        <section className="min-w-0">
          <FactionHero f={current} onCorrect={() => setCorrecting(true)} />
          <RepTables key={factionKey(current)} f={current} />
          {data.unmatched > 0 && <p className="mt-3 text-xs text-white/40">{t("reputation.unmatched", { count: data.unmatched })}</p>}
        </section>
      </div>
      {correcting && <CorrectRankModal f={current} onSave={save} onReset={reset} onClose={() => setCorrecting(false)} />}
    </div>
  );
}
