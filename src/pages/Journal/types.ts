// Types du Carnet de bord (refonte) — miroir du JSON de get_journal_overview.

export type NamedSeconds = { name: string; seconds: number };

export type Overview = {
  character: string | null;
  playtime: { totalSeconds: number; sessions: number };
  streak: { current: number; record: number };
  lastSession: {
    date: string | null;
    durationSeconds: number;
    vehicle: string | null;
    location: string | null;
  } | null;
  heatmap: { date: string; seconds: number }[];
  missions: { completed: number; abandoned: number; failed: number };
  blueprintsUnlocked: number;
  favoriteVehicle: NamedSeconds | null;
  favoriteSystem: NamedSeconds | null;
  topVehicles: { name: string; seconds: number; sessions: number }[];
  topLocations: { name: string; seconds: number; visits: number }[];
  systems: NamedSeconds[];
  spendingByShop: { shop: string; spent: number; count: number }[];
  spendingTotal: number;
  spendingCount: number;
};

export type Period = 30 | 90 | null; // null = tout
