// Libellé, teinte et contenu d'un élément de la frise « Dernière session » (pur).
import type { SessionItem } from "../types";

export type Tone = "success" | "danger" | "warning" | "info" | "accent" | "mute";

export interface ItemView {
  tone: Tone;
  titleKey: string;
  title?: string | null;
  count?: number;
  rep?: { faction: string; amount: number }[];
  loot?: number;
}

/** « RSI_Perseus » → « RSI Perseus ». */
const pretty = (s: string | null) => (s ? s.replace(/_/g, " ") : null);

export function describeItem(it: SessionItem): ItemView {
  switch (it.kind) {
    case "ended": {
      const tone: Tone = it.outcome === "completed" ? "success" : it.outcome === "abandoned" ? "mute" : "danger";
      const titleKey = it.outcome === "completed" ? "resume.ev.completed" : it.outcome === "abandoned" ? "resume.ev.abandoned" : "resume.ev.failed";
      return { tone, titleKey, title: it.title, rep: it.rep, loot: it.loot.length };
    }
    case "accepted":
      return { tone: "accent", titleKey: "resume.ev.accepted", title: it.title };
    case "vehicle":
      return { tone: "warning", titleKey: "resume.ev.vehicle", title: pretty(it.vehicle) };
    case "quantum":
      return { tone: "info", titleKey: "resume.ev.quantum", title: pretty(it.destination), count: it.count };
    case "system":
      return { tone: "info", titleKey: "resume.ev.system", title: it.system };
    case "death":
      return { tone: "danger", titleKey: "resume.ev.death", title: it.zone };
    case "login":
      return { tone: "mute", titleKey: "resume.ev.login", title: it.character };
  }
}

export function durationParts(seconds: number): { h: number; m: number } {
  const min = Math.floor(seconds / 60);
  return { h: Math.floor(min / 60), m: min % 60 };
}
