// Onglet « Reprendre ma partie » du hub Inventaire (maquette docs/design/maquette-reprendre-reputation.html) :
// où j'en étais, frise de la dernière session, objectifs de réputation, objets sur moi et ailleurs.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { placeLabel } from "../../lib/gameLocation";
import type { FactionRep, ReputationOverview } from "../../lib/reputation";
import { useMapContext } from "../../components/starmap3d/useMapContext";
import { applyMeta, buildScopeTree, rowsForMoi } from "../Inventory/aggregate";
import type { InvState, ItemMeta } from "../Inventory/types";
import type { LastSession } from "./types";
import { WhereBanner } from "./components/WhereBanner";
import { SessionTimeline } from "./components/SessionTimeline";
import { GoalsCard } from "./components/GoalsCard";
import { InventoryCards } from "./components/InventoryCards";

export default function ResumePage() {
  const [session, setSession] = useState<LastSession | null>(null);
  const [factions, setFactions] = useState<FactionRep[]>([]);
  const [inv, setInv] = useState<InvState | null>(null);
  const [meta, setMeta] = useState<Record<string, ItemMeta>>({});
  const [handle, setHandle] = useState<string | null>(null);
  const map = useMapContext();

  useEffect(() => {
    const load = () => {
      invoke<LastSession | null>("get_last_session").then(setSession).catch(() => setSession(null));
      invoke<ReputationOverview>("get_reputation_overview").then((d) => setFactions(d.factions)).catch(() => setFactions([]));
    };
    load();
    invoke<InvState>("inventory_state").then(setInv).catch(() => setInv(null));
    void Promise.all([invoke<string | null>("get_active_account_id"), invoke<{ id: string; handle: string }[]>("get_accounts")])
      .then(([id, accounts]) => setHandle(accounts.find((a) => a.id === id)?.handle ?? null))
      .catch(() => {});
    const un = listen<{ kind: string }>("gamelog:event", (e) => {
      if (e.payload.kind === "mission" || e.payload.kind === "mission_title") load();
    });
    return () => void un.then((f) => f());
  }, []);

  const onMeRaw = useMemo(() => (inv ? rowsForMoi(inv) : []), [inv]);
  const classes = onMeRaw.map((r) => r.classe).join("|");
  useEffect(() => {
    if (!classes) return;
    invoke<Record<string, ItemMeta>>("inventory_item_meta", { classes: classes.split("|") }).then(setMeta).catch(() => {});
  }, [classes]);
  const onMe = useMemo(() => applyMeta(onMeRaw, meta), [onMeRaw, meta]);
  const places = useMemo(
    () => (inv ? Object.values(buildScopeTree(inv, []).placesByPlanet).flat().sort((a, b) => b.count - a.count) : []),
    [inv],
  );

  return (
    <div className="h-full overflow-y-auto px-6 pb-28 pt-4">
      <div className="mx-auto max-w-[1440px]">
        <WhereBanner
          place={session?.location ? placeLabel(session.location) : null}
          system={session?.system ?? null}
          start={session?.start ?? null}
          durationSeconds={session?.durationSeconds ?? 0}
          handle={handle}
          body={map.here}
        />
        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <SessionTimeline items={session?.items ?? []} />
            <GoalsCard factions={factions} />
          </div>
          <div className="min-w-0">
            <InventoryCards onMe={onMe} places={places} />
          </div>
        </div>
      </div>
    </div>
  );
}
