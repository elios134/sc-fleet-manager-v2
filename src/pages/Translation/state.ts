// Logique pure de la page Traduction (testée en node).
import type { ChannelInfo, Pack } from "./types";

/** Retour immédiat du formulaire « source perso » (le Rust reste l'autorité). */
export function checkSourceUrl(raw: string): "ok" | "notHttps" | "notIni" {
  const url = raw.trim();
  if (!url.startsWith("https://")) return "notHttps";
  const path = url.split(/[?#]/)[0].toLowerCase();
  return path.endsWith(".ini") ? "ok" : "notIni";
}

/** Pack installé sur le canal mais absent de la vitrine (source retirée, pack sorti du feed,
 *  hors-ligne) : on ajoute une carte pour pouvoir encore le mettre à jour / désinstaller. */
export function withOrphan(packs: Pack[], ch: ChannelInfo | null): Pack[] {
  const inst = ch?.install;
  if (!inst || packs.some((p) => p.id === inst.packId)) return packs;
  const orphan: Pack = {
    id: inst.packId,
    name: inst.packId.replace(/^custom:/, ""),
    author: "",
    description: "",
    lang: [],
    folder: inst.folder,
    url: inst.url,
    featured: false,
    updatedAt: null,
    custom: inst.packId.startsWith("custom:"),
  };
  return [...packs, orphan];
}

/** Pack actif du canal (héros) et autres packs (liste compacte), ordre conservé. */
export function splitPacks(packs: Pack[], ch: ChannelInfo | null): { active: Pack | null; others: Pack[] } {
  const id = ch?.install?.packId ?? null;
  const active = id ? packs.find((p) => p.id === id) ?? null : null;
  return { active, others: active ? packs.filter((p) => p !== active) : packs };
}
