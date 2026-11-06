import { describe, it, expect } from "vitest";
import { fmtNewsDate, statusColor } from "./news";

describe("fmtNewsDate", () => {
  it("date relative de RSI traduite dans la langue de l'appli", () => {
    expect(fmtNewsDate("2 days ago", "fr")).toBe("il y a 2 jours");
    expect(fmtNewsDate("1 week ago", "fr")).toBe("il y a 1 semaine");
    expect(fmtNewsDate("3 hours ago", "en")).toBe("3 hours ago");
  });
  it("vide → rien ; texte inconnu gardé tel quel", () => {
    expect(fmtNewsDate(null, "fr")).toBe("");
    expect(fmtNewsDate("bientôt", "fr")).toBe("bientôt");
  });
  it("date ISO mise en forme", () => {
    expect(fmtNewsDate("2026-10-21T12:00:00Z", "fr")).toContain("2026");
  });
});

describe("statusColor", () => {
  it("couleur du thème selon le statut, neutre si inconnu", () => {
    expect(statusColor("operational")).toBe("var(--success)");
    expect(statusColor("degraded")).toBe("var(--amber)");
    expect(statusColor("partial")).toBe("var(--amber)");
    expect(statusColor("major")).toBe("var(--danger)");
    expect(statusColor("maintenance")).toBe("var(--info)");
    expect(statusColor("???")).toBe("var(--muted)");
  });
});
