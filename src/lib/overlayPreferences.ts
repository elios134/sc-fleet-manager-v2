export type OverlayVisualStyle = "projection" | "panel";

export type OverlaySettings = {
  opacity: number;
  clickThrough: boolean;
  locked: boolean;
  compact: boolean;
  visualStyle: OverlayVisualStyle;
  panels: { route: boolean; timers: boolean };
  routeDetails: { scu: boolean; time: boolean; fuel: boolean; profit: boolean };
  timers: { hangar: boolean; independent: boolean };
  defaultTab: "route" | "timers";
};

export function createOverlayDefaults(): OverlaySettings {
  return {
    opacity: 0.9,
    clickThrough: false,
    locked: false,
    compact: false,
    visualStyle: "projection",
    panels: { route: true, timers: true },
    routeDetails: { scu: true, time: true, fuel: true, profit: true },
    timers: { hangar: true, independent: true },
    defaultTab: "route",
  };
}

export function normalizeOverlaySettings(value: Partial<OverlaySettings>): OverlaySettings {
  const defaults = createOverlayDefaults();
  return {
    ...defaults,
    ...value,
    visualStyle: value.visualStyle === "panel" ? "panel" : "projection",
    panels: { ...defaults.panels, ...(value.panels ?? {}) },
    routeDetails: { ...defaults.routeDetails, ...(value.routeDetails ?? {}) },
    timers: { ...defaults.timers, ...(value.timers ?? {}) },
  };
}

export function enableManualPositioning(settings: OverlaySettings): OverlaySettings {
  return { ...settings, locked: false, clickThrough: false };
}
