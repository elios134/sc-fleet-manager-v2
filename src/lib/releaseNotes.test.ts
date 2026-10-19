import { describe, it, expect } from "vitest";
import { isNewerVersion, noteHeadlines, parseReleaseNotes, whatsNewFrom } from "./releaseNotes";

const BODY = `## Nouveautés
- **Carte stellaire au niveau du jeu** — Vraies textures, éclairage jour / nuit.
- **Itinéraire multi-étapes** : distances réelles.
* Liste de souhaits CCU

## Corrections
- **Synchronisation de la carte** - « Tout synchroniser » n'efface plus les données RSI.
`;

describe("parseReleaseNotes", () => {
  it("sections (## titre) et puces « **Titre** — texte », « Titre : texte » ou texte seul", () => {
    const s = parseReleaseNotes(BODY);
    expect(s.map((x) => x.title)).toEqual(["Nouveautés", "Corrections"]);
    expect(s[0].items).toEqual([
      { title: "Carte stellaire au niveau du jeu", text: "Vraies textures, éclairage jour / nuit." },
      { title: "Itinéraire multi-étapes", text: "distances réelles." },
      { title: "Liste de souhaits CCU", text: "" },
    ]);
    expect(s[1].items[0]).toEqual({ title: "Synchronisation de la carte", text: "« Tout synchroniser » n'efface plus les données RSI." });
  });
  it("texte libre sans titre ni puce : une section sans titre, une ligne par paragraphe", () => {
    expect(parseReleaseNotes("Mise à jour automatique disponible via l'application.\r\n")).toEqual([
      { title: "", items: [{ title: "Mise à jour automatique disponible via l'application.", text: "" }] },
    ]);
  });
  it("vide → aucune section", () => {
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNotes(null)).toEqual([]);
  });
});

describe("noteHeadlines", () => {
  it("les n premiers titres, toutes sections confondues", () => {
    expect(noteHeadlines(parseReleaseNotes(BODY), 3)).toEqual(["Carte stellaire au niveau du jeu", "Itinéraire multi-étapes", "Liste de souhaits CCU"]);
  });
});

describe("versions", () => {
  it("compare les versions semver (préfixe v toléré)", () => {
    expect(isNewerVersion("3.2.0", "3.1.1")).toBe(true);
    expect(isNewerVersion("v3.10.0", "3.9.9")).toBe(true);
    expect(isNewerVersion("3.1.1", "3.1.1")).toBe(false);
    expect(isNewerVersion("3.1.0", "3.1.1")).toBe(false);
  });
  it("« Quoi de neuf » seulement après une montée de version (pas sur une installation neuve)", () => {
    expect(whatsNewFrom(null, "3.2.0", false)).toBeNull();
    expect(whatsNewFrom("3.2.0", "3.2.0", true)).toBeNull();
    expect(whatsNewFrom("3.1.1", "3.2.0", true)).toBe("3.1.1");
    expect(whatsNewFrom("3.3.0", "3.2.0", true)).toBeNull();
  });
  it("installation existante sans version vue (avant cette fonction) : montée d'origine inconnue", () => {
    expect(whatsNewFrom(null, "3.2.0", true)).toBe("");
  });
});
