import { describe, it, expect } from "vitest";
import { filterMissions, missionCounts, sortMissions } from "./missionView";
import type { MissionListItem } from "../helpers";

const m = (uuid: string, over: Partial<MissionListItem> = {}): MissionListItem =>
  ({ uuid, title: uuid, factionName: null, released: true, hasBlueprints: false, reputationAmount: null, timeMins: null, ...over }) as MissionListItem;
const LIST = [
  m("Data Theft", { factionName: "ArcCorp", reputationAmount: 2000, timeMins: 15, hasBlueprints: true }),
  m("Halt Surveillance", { factionName: "Hurston Dynamics", reputationAmount: 2000, timeMins: 12 }),
  m("Time Trial", { factionName: "Wildstar Racing", reputationAmount: 250, timeMins: 6 }),
  m("Unreleased", { released: false, hasBlueprints: true }),
  m("Bounty", { factionName: "ArcCorp" }),
];
const none = new Set<string>();

describe("filterMissions", () => {
  it("missions publiées seulement ; recherche sur le titre ou la faction, sans casse", () => {
    expect(filterMissions(LIST, { q: "", factions: [], listFilter: "all", objectives: none, favorites: none }).map((x) => x.uuid)).toEqual(["Data Theft", "Halt Surveillance", "Time Trial", "Bounty"]);
    expect(filterMissions(LIST, { q: "arccorp", factions: [], listFilter: "all", objectives: none, favorites: none }).map((x) => x.uuid)).toEqual(["Data Theft", "Bounty"]);
  });
  it("factions choisies, puis filtres Loot / Objectifs / Favoris", () => {
    const base = { q: "", objectives: new Set(["Time Trial"]), favorites: new Set(["Bounty", "Halt Surveillance"]) };
    expect(filterMissions(LIST, { ...base, factions: ["Hurston Dynamics", "Wildstar Racing"], listFilter: "all" }).map((x) => x.uuid)).toEqual(["Halt Surveillance", "Time Trial"]);
    expect(filterMissions(LIST, { ...base, factions: [], listFilter: "loot" }).map((x) => x.uuid)).toEqual(["Data Theft"]);
    expect(filterMissions(LIST, { ...base, factions: [], listFilter: "objectives" }).map((x) => x.uuid)).toEqual(["Time Trial"]);
    expect(filterMissions(LIST, { ...base, factions: [], listFilter: "favorites" }).map((x) => x.uuid)).toEqual(["Halt Surveillance", "Bounty"]);
  });
});

describe("sortMissions", () => {
  const pub = LIST.filter((x) => x.released);
  it("réputation décroissante (inconnue en dernier), durée croissante (inconnue en dernier), A→Z", () => {
    expect(sortMissions(pub, "rep_desc").map((x) => x.uuid)).toEqual(["Data Theft", "Halt Surveillance", "Time Trial", "Bounty"]);
    expect(sortMissions(pub, "duration_asc").map((x) => x.uuid)).toEqual(["Time Trial", "Halt Surveillance", "Data Theft", "Bounty"]);
    expect(sortMissions(pub, "alpha").map((x) => x.uuid)).toEqual(["Bounty", "Data Theft", "Halt Surveillance", "Time Trial"]);
  });
});

describe("missionCounts", () => {
  it("compteurs des puces : publiées, loot publiées, objectifs, favoris ; nombre de factions", () => {
    expect(missionCounts(LIST, new Set(["a"]), new Set(["b", "c"]))).toEqual({ all: 4, loot: 1, objectives: 1, favorites: 2, factions: 3 });
  });
});
