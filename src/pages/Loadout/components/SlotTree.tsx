import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { humanizePortName } from "../../../lib/loadoutSlots";
import { type SlotEdit, type Variant } from "../types";
import { deriveWeaponType, mountName, treeChildren, groupSiblings, VARIANT_COLOR, VARIANT_BORDER, VARIANT_LINE } from "../helpers";

function ContainerHeader({
  slot,
  variant,
  count,
  onClick,
  selected,
}: {
  slot: SlotEdit;
  variant: Variant;
  count: number;
  onClick?: () => void;
  selected?: boolean;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  // Tourelle habitée : libellé générique (pas de composant échangeable). Sinon nom du mount.
  const label = slot.slotType === "TURRET" ? t("loadout.turretManned") : mountName(slot);
  const inner = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="shrink-0 rounded-md border border-white/5 px-1.5 py-0.5 font-mono text-[10px] font-semibold"
        style={{ background: "#26262e", color }}
      >
        S{slot.slotSize}
      </span>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      {count > 1 && (
        <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
          ×{count}
        </span>
      )}
    </div>
  );
  const baseStyle = {
    borderColor: VARIANT_BORDER[variant],
    background: "rgba(255,255,255,0.02)",
    borderLeft: `4px solid ${color}`,
    outline: selected ? `1px solid ${color}` : undefined,
  };
  if (!onClick) {
    return (
      <div className="flex items-center justify-between rounded-xl border p-2.5" style={baseStyle}>
        {inner}
      </div>
    );
  }
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-colors hover:bg-white/[0.06]"
      style={baseStyle}
    >
      {inner}
      <Settings className="h-4 w-4 shrink-0 opacity-30 transition-opacity group-hover:opacity-100" style={{ color }} />
    </div>
  );
}

// Rend un slot + récursivement ses enfants (trait de liaison parent→enfant).

function SlotTree({
  idx,
  variant,
  editSlots,
  childIdxByParent,
  selectedIdx,
  onSelect,
  groupCount,
}: {
  idx: number;
  variant: Variant;
  editSlots: SlotEdit[];
  childIdxByParent: Map<number, number[]>;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  groupCount?: number;
}) {
  const slot = editSlots[idx];
  const childIndices = slot.hardpointId != null ? childIdxByParent.get(slot.hardpointId) ?? [] : [];
  // SlotTree ne sert plus qu'aux sections non-armes (missiles : rack → missiles ; systèmes).
  // Les armes/tourelles/missiles sont rendues par LoadoutNode (rendu erkul).
  return (
    <div>
      <SlotRow
        slot={slot}
        variant={variant}
        selected={idx === selectedIdx}
        onClick={() => onSelect(idx)}
        groupCount={groupCount}
      />
      {childIndices.length > 0 && (
        <div
          className="ml-10 mt-1 space-y-1 pl-3"
          style={{ borderLeft: `2px solid ${VARIANT_LINE[variant]}` }}
        >
          {childIndices.map((ci) => (
            <SlotTree
              key={ci}
              idx={ci}
              variant={variant}
              editSlots={editSlots}
              childIdxByParent={childIdxByParent}
              selectedIdx={selectedIdx}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  variant,
  selected,
  onClick,
  groupCount,
}: {
  slot: SlotEdit;
  variant: Variant;
  selected: boolean;
  onClick: () => void;
  groupCount?: number;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  const isEmpty = !slot.componentName;
  const countBadge = groupCount != null && groupCount > 1 ? ` (${groupCount}×)` : "";

  // Sous-titre : "TYPE D'ARME | PORT" (rempli) ou "PORT" (vide), uppercase atténué.
  const parts: string[] = [];
  if (!isEmpty) {
    const wt = deriveWeaponType(slot.componentClassName);
    if (wt) parts.push(wt);
    if (slot.portName) parts.push(humanizePortName(slot.portName));
  } else if (slot.portName) {
    parts.push(humanizePortName(slot.portName));
  } else {
    parts.push(slot.slotType.replace(/_/g, " "));
  }
  const subtitle = parts.join(" | ");

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
      style={{ borderLeft: `4px solid ${color}`, outline: selected ? `1px solid ${color}` : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/5"
          style={{ background: "#26262e" }}
        >
          <span className="font-mono text-xs font-semibold" style={{ color }}>
            S{slot.slotSize}
          </span>
        </div>
        <div className="min-w-0">
          <div
            className="truncate text-sm font-semibold"
            style={{ color: isEmpty ? "rgba(255,255,255,0.3)" : "#fff" }}
          >
            {isEmpty ? t("loadout.slotEmpty") : `${slot.componentName}${countBadge}`}
          </div>
          <div
            className="mt-0.5 truncate text-[10px] uppercase"
            style={{ color, opacity: 0.6, letterSpacing: "0.05em" }}
          >
            {subtitle}
          </div>
        </div>
      </div>
      <Settings
        className="h-[18px] w-[18px] shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
        style={{ color }}
      />
    </div>
  );
}

// Ligne feuille (canon ou missile) : nom du composant + taille + ×N + stat (dps cumulé).

function LeafRow({
  slot,
  variant,
  count,
  stat,
  selected,
  onClick,
}: {
  slot: SlotEdit;
  variant: Variant;
  count: number;
  stat: number | null;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  const isEmpty = !slot.componentName;
  const parts: string[] = [];
  if (!isEmpty) {
    const wt = deriveWeaponType(slot.componentClassName);
    if (wt) parts.push(wt);
  }
  if (slot.portName) parts.push(humanizePortName(slot.portName));
  const subtitle = parts.join(" | ");
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
      style={{ borderLeft: `4px solid ${color}`, outline: selected ? `1px solid ${color}` : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/5"
          style={{ background: "#26262e" }}
        >
          <span className="font-mono text-xs font-semibold" style={{ color }}>
            S{slot.slotSize}
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: isEmpty ? "rgba(255,255,255,0.3)" : "#fff" }}>
            {isEmpty ? t("loadout.slotEmpty") : slot.componentName}
            {count > 1 && <span style={{ color, opacity: 0.85 }}> ×{count}</span>}
          </div>
          <div className="mt-0.5 truncate text-[10px] uppercase" style={{ color, opacity: 0.6, letterSpacing: "0.05em" }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {stat != null && stat > 0 && (
          <span className="font-mono text-xs font-semibold" style={{ color: "#fff", opacity: 0.85 }}>
            {Math.round(stat)} dps
          </span>
        )}
        <Settings className="h-[18px] w-[18px] opacity-40 transition-opacity group-hover:opacity-100" style={{ color }} />
      </div>
    </div>
  );
}

/* ── Helpers d'arbre (rendu erkul : hiérarchie déroulée + regroupement ×N) ── */

// Enfants d'un slot appartenant aux familles de la section (WEAPON/TURRET, ou MISSILE).

function LoadoutNode({
  rep,
  members,
  mult,
  families,
  variant,
  editSlots,
  childIdxByParent,
  selectedIdx,
  onPick,
}: {
  rep: number;
  members: number[];
  mult: number;
  families: string[];
  variant: Variant;
  editSlots: SlotEdit[];
  childIdxByParent: Map<number, number[]>;
  selectedIdx: number | null;
  onPick: (idxs: number[]) => void;
}) {
  const slot = editSlots[rep];
  const count = members.length * mult;
  const isMissile = families[0] === "MISSILE";
  const selected = selectedIdx != null && members.includes(selectedIdx);

  const kids = treeChildren(rep, editSlots, childIdxByParent, families)
    .slice()
    .sort((a, b) => editSlots[b].slotSize - editSlots[a].slotSize);
  const isLeaf = kids.length === 0;

  // Feuille : canon ou missile.
  if (isLeaf) {
    const editIdxs = isMissile ? members : [rep]; // missile = groupe entier ; arme = un seul
    return (
      <LeafRow
        slot={slot}
        variant={variant}
        count={count}
        stat={slot.realDps != null ? slot.realDps * count : null}
        selected={selected}
        onClick={() => onPick(editIdxs)}
      />
    );
  }

  // Conteneur / mount / rack : en-tête + enfants regroupés.
  // Cliquable sauf tourelle habitée (type TURRET sans composant échangeable).
  const clickable = slot.slotType !== "TURRET";
  const childGroups = groupSiblings(kids, editSlots, childIdxByParent, families);
  return (
    <div>
      <ContainerHeader
        slot={slot}
        variant={variant}
        count={count}
        selected={selected}
        onClick={clickable ? () => onPick([rep]) : undefined}
      />
      <div className="ml-6 mt-1.5 space-y-1.5 pl-3" style={{ borderLeft: `2px solid ${VARIANT_LINE[variant]}` }}>
        {childGroups.map((g) => (
          <LoadoutNode
            key={g.rep}
            rep={g.rep}
            members={g.members}
            mult={count}
            families={families}
            variant={variant}
            editSlots={editSlots}
            childIdxByParent={childIdxByParent}
            selectedIdx={selectedIdx}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

// Agrégation fidèle de loadoutStats.ts V1 (sommes des stats réelles équipées).
// editSlots est déjà à plat (pré-ordre incluant les enfants) → pas de récursion.

export { ContainerHeader, SlotTree, SlotRow, LeafRow, LoadoutNode };
