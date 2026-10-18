import { describe, it, expect } from "vitest";
import { cardState, kpis, timelineEvents, segmentsFilled } from "./timeline";
import type { InsuranceRow } from "../../lib/insurance";

let id = 0;
const row = (daysLeft: number | null, opts: Partial<InsuranceRow> = {}): InsuranceRow => ({
  shipId: ++id, name: `S${daysLeft}`, manufacturer: "", lti: false, insuranceDuration: 6,
  typeLabel: "", expiryLabel: "", status: "ACTIVE", daysLeft, expiryIso: null, ...opts,
});
const ROWS = [row(null, { lti: true }), row(-2), row(5), row(13), row(26)];

describe("kpis", () => {
  it("compteurs", () => expect(kpis(ROWS)).toEqual({ covered: 5, lti: 1, soon: 2, expired: 1, nextDays: 5 }));
});

describe("timelineEvents", () => {
  const ev = timelineEvents([...ROWS, row(400)], 30);
  it("garde expirées et échéances dans la fenêtre", () => expect(ev.length).toBe(4));
  it("expirée à 0 %, ton bad", () => expect(ev.find((e) => e.label === "S-2")).toMatchObject({ pct: 0, tone: "bad" }));
  it("26 j ≈ 86,7 %, ton ok", () => {
    const e = ev.find((x) => x.label === "S26")!;
    expect(e.tone).toBe("ok");
    expect(e.pct).toBeCloseTo(86.7, 1);
  });
  it("LTI et hors fenêtre absents", () => {
    expect(ev.some((e) => e.label === "Snull")).toBe(false);
    expect(ev.some((e) => e.label === "S400")).toBe(false);
  });
});

describe("segmentsFilled", () => {
  it("bornes et cas particuliers", () => {
    expect(segmentsFilled(row(null, { lti: true }), 10)).toBe(10);
    expect(segmentsFilled(row(-2), 10)).toBe(10);
    expect(segmentsFilled(row(26), 10)).toBe(1);
    expect(segmentsFilled(row(26, { insuranceDuration: null }), 10)).toBe(0);
    expect(segmentsFilled(row(400), 10)).toBe(10);
  });
});

describe("timelineEvents : étiquettes dans le cadre", () => {
  it("expirées regroupées en une seule étiquette avec leur nombre", () => {
    const ev = timelineEvents([row(-2), row(-40), row(-400), row(5)], 30);
    const bad = ev.filter((e) => e.tone === "bad");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ pct: 0, count: 3, anchor: "left" });
  });
  it("ancrage gauche / centre / droite selon la position", () => {
    const ev = timelineEvents([row(1), row(15), row(29)], 30);
    expect(ev.map((e) => e.anchor)).toEqual(["left", "center", "right"]);
  });
});

describe("cardState : même seuil que les filtres", () => {
  it("LTI, inconnue, expirée, à surveiller (statut WARNING), active", () => {
    expect(cardState(row(null, { lti: true }))).toBe("lti");
    expect(cardState(row(null))).toBe("unknown");
    expect(cardState(row(-3, { status: "EXPIRED" }))).toBe("expired");
    expect(cardState(row(20, { status: "WARNING" }))).toBe("soon");
    expect(cardState(row(60))).toBe("active");
  });
});
