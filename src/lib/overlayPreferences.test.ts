import { describe, expect, test } from "vitest";
import { createOverlayDefaults, enableManualPositioning } from "./overlayPreferences";

describe("overlay preferences", () => {
  test("uses the lightweight projection style by default", () => {
    expect(createOverlayDefaults().visualStyle).toBe("projection");
  });

  test("enables interaction while preserving the selected visual style for manual positioning", () => {
    const settings = {
      ...createOverlayDefaults(),
      visualStyle: "panel" as const,
      locked: true,
      clickThrough: true,
    };

    expect(enableManualPositioning(settings)).toMatchObject({
      visualStyle: "panel",
      locked: false,
      clickThrough: false,
    });
  });
});
