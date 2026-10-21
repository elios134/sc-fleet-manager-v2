import { describe, it, expect } from "vitest";
import {
  computeCurrentRank,
  computeRepeatsNeeded,
  computeTotalFarmTime,
  findOptimalMission,
  isCleanDescription,
  mapRewardScopeToScopeName,
  mapScopeFamily,
  type MissionListItem,
} from "./helpers";

const mission = (over: Partial<MissionListItem>): MissionListItem => ({
  uuid: "m", title: "M", description: null, factionName: null, factionUuid: "f1", factionType: null,
  rewardScope: null, illegal: false, legalityLabel: null, hasBlueprints: false, blueprintDropChance: null,
  rewardMin: null, rewardMax: null, rewardCurrency: null, timeMins: 10, shareable: false, hasCombat: false,
  hasHauling: false, hasDefend: false, minStandingName: null, minStandingValue: null, maxStandingName: null,
  maxStandingValue: null, released: true, workInProgress: false, notForRelease: false, starSystems: null,
  reputationGained: null, cooldownJson: null, reputationAmount: 100, gameVersion: null, webUrl: null,
  source: "wiki", blueprints: [], ...over,
});

describe("mapScopeFamily", () => {
  it("combat d'abord (drapeau ou mots-clés), puis salvage, recovery, hauling, cargo, autre", () => {
    expect(mapScopeFamily(mission({ hasCombat: true, rewardScope: "Cargo" }))).toBe("combat");
    expect(mapScopeFamily(mission({ rewardScope: "Bounty Hunter" }))).toBe("combat");
    expect(mapScopeFamily(mission({ rewardScope: "Salvage" }))).toBe("salvage");
    expect(mapScopeFamily(mission({ rewardScope: "Rescue" }))).toBe("recovery");
    expect(mapScopeFamily(mission({ hasHauling: true }))).toBe("hauling");
    expect(mapScopeFamily(mission({ rewardScope: "Delivery" }))).toBe("cargo");
    expect(mapScopeFamily(mission({ rewardScope: "Medical" }))).toBe("other");
  });
});

describe("isCleanDescription", () => {
  it("masque les descriptions vides ou à template non résolu", () => {
    expect(isCleanDescription(null)).toBe(false);
    expect(isCleanDescription("Livrer ~mission(Location) avant ce soir")).toBe(false);
    expect(isCleanDescription("Livrer le colis à Area 18.")).toBe(true);
  });
});

describe("mapRewardScopeToScopeName", () => {
  it("scope connu, scope sans réputation, ou réputation de faction par défaut", () => {
    expect(mapRewardScopeToScopeName("Bounty Hunter")).toBe("BountyHunter");
    expect(mapRewardScopeToScopeName("Cargo")).toBeNull();
    expect(mapRewardScopeToScopeName("Inconnu")).toBeNull();
    expect(mapRewardScopeToScopeName(null)).toBe("FactionReputation");
  });
});

describe("computeCurrentRank", () => {
  const rank = (i: number, min: number) => ({ id: `r${i}`, scopeId: "s", name: `R${i}`, nameKey: "", minReputation: min, rangeXP: null, rankIndex: i });
  const ranks = [rank(2, 1000), rank(0, 0), rank(1, 400)];
  it("rang courant, suivant et progression dans le rang", () => {
    const r = computeCurrentRank(700, ranks);
    expect(r.currentRank?.id).toBe("r1");
    expect(r.nextRank?.id).toBe("r2");
    expect(r.progressPercent).toBe(50);
    expect(r.repToNextRank).toBe(300);
  });
  it("rang max : 100 % ; aucun rang : vide", () => {
    expect(computeCurrentRank(5000, ranks)).toMatchObject({ nextRank: null, progressPercent: 100, repToNextRank: 0 });
    expect(computeCurrentRank(10, [])).toEqual({ currentRank: null, nextRank: null, progressPercent: 0, repToNextRank: 0 });
  });
});

describe("reco de farm", () => {
  it("meilleur ratio réputation / minute de la faction, missions publiées seulement", () => {
    const all = [
      mission({ uuid: "a", reputationAmount: 100, timeMins: 10 }),
      mission({ uuid: "b", reputationAmount: 300, timeMins: 20 }),
      mission({ uuid: "c", reputationAmount: 900, timeMins: 10, released: false }),
      mission({ uuid: "d", reputationAmount: 900, timeMins: 10, factionUuid: "autre" }),
    ];
    expect(findOptimalMission(all, "f1")?.uuid).toBe("b");
    expect(findOptimalMission(all, null)).toBeNull();
  });
  it("runs nécessaires et temps total", () => {
    expect(computeRepeatsNeeded(1000, 400, 150)).toBe(4);
    expect(computeRepeatsNeeded(1000, 1200, 150)).toBe(0);
    expect(computeRepeatsNeeded(1000, 0, 0)).toBe(Infinity);
    expect(computeTotalFarmTime(4, 12)).toBe(48);
    expect(computeTotalFarmTime(0, 12)).toBe(0);
  });
});
