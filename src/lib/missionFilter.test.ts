import { describe, it, expect } from "vitest";
import { filterSortMissions, type FilterableMission } from "./missionFilter";

const m = (over: Partial<FilterableMission> = {}): FilterableMission => ({
  released: true,
  title: "Mission",
  factionName: null,
  reputationAmount: null,
  timeMins: null,
  ...over,
});

describe("filterSortMissions", () => {
  it("exclut les missions non publiées", () => {
    const out = filterSortMissions([m({ title: "A" }), m({ title: "B", released: false })], "", [], "title_asc");
    expect(out.map((x) => x.title)).toEqual(["A"]);
  });

  it("recherche sur titre et nom de faction", () => {
    const list = [m({ title: "Escorte" }), m({ title: "Livraison", factionName: "Hurston" })];
    expect(filterSortMissions(list, "hurston", [], "title_asc").map((x) => x.title)).toEqual(["Livraison"]);
    expect(filterSortMissions(list, "escorte", [], "title_asc").map((x) => x.title)).toEqual(["Escorte"]);
  });

  it("filtre par factions sélectionnées", () => {
    const list = [m({ title: "A", factionName: "X" }), m({ title: "B", factionName: "Y" })];
    expect(filterSortMissions(list, "", ["Y"], "title_asc").map((x) => x.title)).toEqual(["B"]);
  });

  it("trie par réputation desc (nulls en dernier)", () => {
    const list = [m({ title: "lo", reputationAmount: 10 }), m({ title: "hi", reputationAmount: 100 }), m({ title: "none" })];
    expect(filterSortMissions(list, "", [], "rep_desc").map((x) => x.title)).toEqual(["hi", "lo", "none"]);
  });

  it("trie par durée asc (nulls en dernier)", () => {
    const list = [m({ title: "long", timeMins: 60 }), m({ title: "court", timeMins: 5 }), m({ title: "none" })];
    expect(filterSortMissions(list, "", [], "duration_asc").map((x) => x.title)).toEqual(["court", "long", "none"]);
  });

  it("trie par titre par défaut", () => {
    const list = [m({ title: "Charlie" }), m({ title: "Alpha" }), m({ title: "Bravo" })];
    expect(filterSortMissions(list, "", [], "title_asc").map((x) => x.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
});
