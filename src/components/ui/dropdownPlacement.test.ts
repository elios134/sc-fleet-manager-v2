import { describe, it, expect } from "vitest";
import { menuPlacement } from "./dropdownPlacement";

describe("menuPlacement", () => {
  const MENU = 300;
  it("vers le bas quand la place suffit en dessous", () => {
    expect(menuPlacement({ top: 100, bottom: 136 }, { top: 0, bottom: 900 }, MENU)).toBe("down");
  });
  it("vers le haut quand le menu serait coupé en bas et qu'il y a plus de place au-dessus", () => {
    expect(menuPlacement({ top: 700, bottom: 736 }, { top: 0, bottom: 860 }, MENU)).toBe("up");
  });
  it("reste vers le bas si le haut n'offre pas plus de place", () => {
    expect(menuPlacement({ top: 120, bottom: 156 }, { top: 100, bottom: 400 }, MENU)).toBe("down");
  });
});
