// Logique pure de la page Traduction (testée en node).
import type { ChannelInfo, Pack } from "./types";

export type PackState = "notInstalled" | "upToDate" | "updateAvailable" | "otherActive";

/** État d'un pack sur le canal sélectionné (un seul pack actif par canal). */
export function packState(pack: Pack, ch: ChannelInfo | null): PackState {
  const inst = ch?.install;
  if (!inst) return "notInstalled";
  if (inst.packId !== pack.id) return "otherActive";
  return inst.updateAvailable ? "updateAvailable" : "upToDate";
}

/** Retour immédiat du formulaire « source perso » (le Rust reste l'autorité). */
export function checkSourceUrl(raw: string): "ok" | "notHttps" | "notIni" {
  const url = raw.trim();
  if (!url.startsWith("https://")) return "notHttps";
  const path = url.split(/[?#]/)[0].toLowerCase();
  return path.endsWith(".ini") ? "ok" : "notIni";
}
