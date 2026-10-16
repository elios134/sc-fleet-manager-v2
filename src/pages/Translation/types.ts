// Miroirs TS des structures Rust (commands/translation, camelCase via serde).
export type Pack = {
  id: string;
  name: string;
  author: string;
  description: string;
  lang: string[];
  folder: string;
  url: string;
  featured: boolean;
  updatedAt: string | null;
  custom: boolean;
};
export type InstallRow = {
  channelPath: string;
  packId: string;
  folder: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
  updateAvailable: boolean;
  installedAt: string;
  checkedAt: string | null;
};
export type ChannelInfo = {
  path: string;
  label: string;
  manual: boolean;
  install: InstallRow | null;
  currentLanguage: string | null;
};
export type InstallOutcome = { kind: "installed" } | { kind: "conflict"; current: string };
