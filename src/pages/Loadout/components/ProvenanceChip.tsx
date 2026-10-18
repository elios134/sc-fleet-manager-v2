import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { Provenance } from "../cost";
import type { SlotEdit } from "../types";
import { appLocale } from "../../../lib/format";

/** Fournit la provenance d'un slot équipé (page Configurateur) ; null = inconnue / non chargée. */
export const ProvenanceContext = createContext<(slot: SlotEdit) => Provenance | null>(() => null);

/* Pastille « D'origine » / « Magasin · prix » / « Craftable » sous le nom du composant. */
export function ProvenanceChip({ slot }: { slot: SlotEdit }) {
  const { t } = useTranslation();
  const p = useContext(ProvenanceContext)(slot);
  if (!slot.componentName || !p || p.kind === "unknown") return null;
  const base = "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal";
  if (p.kind === "stock") return <span className={`${base} border-emerald-400/40 bg-emerald-400/15 text-emerald-200`}>{t("loadout.provStock")}</span>;
  if (p.kind === "craft") return <span className={`${base} border-white/15 text-white/60`}>{t("loadout.provCraft")}</span>;
  return (
    <span className={`${base} border-[var(--accent)]/50 bg-[var(--accent)]/20 text-indigo-200`}>
      {p.terminal} · {Math.round(p.price).toLocaleString(appLocale())} aUEC
    </span>
  );
}
