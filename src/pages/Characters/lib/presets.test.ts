import { describe, expect, it } from "vitest";
import { installedNames, isInstalled, mergePages, uniqueLocal } from "./presets";

const local = (name: string, channel = "LIVE") => ({ name, path: `${channel}/${name}.chf`, channel, modifiedAt: null });

describe("presets", () => {
  it("un preset du catalogue est « dans le jeu » si un fichier local porte son nom (casse et caractères interdits ignorés)", () => {
    const names = installedNames([local("John Wick"), local("a_b")]);
    expect(isInstalled("john wick", names)).toBe(true);
    expect(isInstalled(" John Wick ", names)).toBe(true);
    expect(isInstalled("a/b", names)).toBe(true);
    expect(isInstalled("Ember", names)).toBe(false);
  });

  it("pages ajoutées sans doublon", () => {
    const p = (id: string) => ({ id, title: id, author: null, createdAt: null, previewUrl: null, dnaUrl: `${id}.chf`, downloads: 0, likes: 0 });
    expect(mergePages([p("a"), p("b")], [p("b"), p("c")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("un preset présent dans plusieurs canaux apparaît une fois, avec ses canaux", () => {
    expect(uniqueLocal([local("John Wick"), local("John Wick", "PTU"), local("Ember")])).toEqual([
      { name: "Ember", channels: ["LIVE"], paths: ["LIVE/Ember.chf"], modifiedAt: null },
      { name: "John Wick", channels: ["LIVE", "PTU"], paths: ["LIVE/John Wick.chf", "PTU/John Wick.chf"], modifiedAt: null },
    ]);
  });
});
