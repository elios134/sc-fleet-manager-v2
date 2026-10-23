import { describe, it, expect } from "vitest";
import { firstSteps, type FirstStepsInput } from "./firstSteps";

const base: FirstStepsInput = { hasAccount: false, wikiSynced: false, uexSynced: false, starmapReady: false, gamelogFound: false };

describe("firstSteps", () => {
  it("5 étapes dans l'ordre, chacune cochée depuis l'état réel", () => {
    const s = firstSteps({ ...base, hasAccount: true, uexSynced: true });
    expect(s.steps.map((x) => [x.key, x.done])).toEqual([
      ["account", true],
      ["wiki", false],
      ["uex", true],
      ["starmap", false],
      ["gamelog", false],
    ]);
    expect(s.doneCount).toBe(2);
    expect(s.next).toBe("wiki");
    expect(s.allDone).toBe(false);
  });
  it("tout fait : plus d'étape suivante", () => {
    const s = firstSteps({ hasAccount: true, wikiSynced: true, uexSynced: true, starmapReady: true, gamelogFound: true });
    expect(s.allDone).toBe(true);
    expect(s.next).toBeNull();
    expect(s.doneCount).toBe(5);
  });
});
