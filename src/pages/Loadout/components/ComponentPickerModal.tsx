import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronUp, Hammer, Loader2, Package, PackageOpen, Search, ShoppingCart, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { humanizePortName } from "../../../lib/loadoutSlots";
import { SLOT_TYPE_SPECS, type SlotEdit, type ComponentRow, type StatSpec } from "../types";
import { gradeRank, gradeColor, deriveWeaponType, getStat, formatStat } from "../helpers";
import { AcquisitionDetailModal } from "./AcquisitionDetailModal";
import { AcqIcon } from "./AcqIcon";

function ComponentPickerModal({
  slot,
  shipDataId,
  isMount,
  onPick,
  onClear,
  onClose,
}: {
  slot: SlotEdit;
  shipDataId: number | null;
  isMount: boolean;
  onPick: (c: ComponentRow) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Filtre d'acquisition (Lot 5) : tous / achetables / craftables / stock vaisseau.
  const [acqFilter, setAcqFilter] = useState<"all" | "buy" | "craft" | "stock">("all");
  // Mini-modale de détail d'acquisition (clic sur une icône 🛒/🔧/📦).
  const [acqDetail, setAcqDetail] = useState<{ comp: ComponentRow; kind: "buy" | "craft" | "stock" } | null>(null);
  // Tri d'affichage (pur front). null = état GROUPÉ par sous-type (défaut à l'ouverture).
  const [sortKey, setSortKey] = useState<keyof ComponentRow | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Repart en état groupé (sans tri, sans filtre) à chaque changement de slot / réouverture.
    setSortKey(null);
    setSortDir("desc");
    setAcqFilter("all");
    // Matching fin (Lot 2) : résolu côté Rust à partir du (shipDataId, portName) du slot —
    // type, taille bornée, subType et famille de required_tags (réplique getCompatible V1).
    const query: Promise<ComponentRow[]> =
      shipDataId != null && (slot.portName || slot.hardpointId != null)
        ? invoke<ComponentRow[]>("get_components_for_slot", {
            shipDataId,
            portName: slot.portName,
            // Cible le hardpoint exact (portName non unique) ; null pour anciens profils.
            hardpointId: slot.hardpointId ?? null,
          })
        : Promise.resolve([]);
    query
      .then((data) => {
        if (cancelled) return;
        // Masque les WeaponDefensive (contre-mesures) — réplique isHiddenFromPicker V1.
        const visible = data.filter((c) => c.scWikiType !== "WeaponDefensive");
        // Dédup par NOM affiché : la base contient de nombreuses variantes internes au même
        // nom (ex. "VariPuck S3 Gimbal Mount" ×11, "Remote Turret" ×78, une par vaisseau).
        // On garde une seule entrée par nom, en privilégiant le className le plus générique
        // (le plus court → ex. Mount_Gimbal_S3 plutôt que Mount_Gimbal_S3_Perseus_Bottom).
        const byName = new Map<string, ComponentRow>();
        for (const c of visible) {
          const prev = byName.get(c.name);
          if (!prev || c.className.length < prev.className.length) byName.set(c.name, c);
        }
        setComponents(Array.from(byName.values()));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipDataId, slot.portName, slot.hardpointId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return components.filter((c) => {
      if (acqFilter === "buy" && c.buyable !== 1) return false;
      if (acqFilter === "craft" && c.craftable !== 1) return false;
      if (acqFilter === "stock" && !c.stockShips) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.manufacturer?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [components, search, acqFilter]);

  const spec = SLOT_TYPE_SPECS[slot.slotType] ?? [];
  const portLabel = slot.portName ? humanizePortName(slot.portName) : slot.slotType.replace(/_/g, " ");

  // Groupe les armes par type (LASER/BALLISTIC…) ; liste plate pour les autres types.
  const grouped: Array<{ group: string | null; items: ComponentRow[] }> =
    slot.slotType === "WEAPON"
      ? (() => {
          const map = new Map<string, ComponentRow[]>();
          for (const c of filtered) {
            const key = deriveWeaponType(c.className) ?? t("loadout.pickerGroupOther");
            const arr = map.get(key) ?? [];
            arr.push(c);
            map.set(key, arr);
          }
          return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
        })()
      : [{ group: null, items: filtered }];

  // Cycle de tri : autre colonne → décroissant ; même colonne : décroissant → croissant
  // → neutre (retour à l'état groupé).
  function handleSort(col: keyof ComponentRow) {
    if (sortKey !== col) {
      setSortKey(col);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortKey(null);
    }
  }

  // Liste à plat triée (quand un tri est actif). null si état groupé.
  const sortedList = useMemo<ComponentRow[] | null>(() => {
    if (sortKey == null) return null;
    const getVal = (c: ComponentRow): number | null =>
      sortKey === "size"
        ? c.size
        : sortKey === "grade"
          ? gradeRank(c.grade)
          : getStat(c, sortKey);
    return filtered
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const va = getVal(a.c);
        const vb = getVal(b.c);
        if (va == null && vb == null) return a.i - b.i; // stable
        if (va == null) return 1; // valeurs manquantes toujours en fin
        if (vb == null) return -1;
        if (va !== vb) return sortDir === "desc" ? vb - va : va - vb;
        return a.i - b.i; // tri stable à valeur égale
      })
      .map((x) => x.c);
  }, [filtered, sortKey, sortDir]);

  // En-tête de colonne cliquable avec indicateur de tri.
  function sortHeader(label: string, col: keyof ComponentRow, align: "left" | "right") {
    const active = sortKey === col;
    return (
      <button
        type="button"
        onClick={() => handleSort(col)}
        className={[
          "flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors",
          align === "right" ? "justify-end" : "",
          active ? "text-white/80" : "text-white/40 hover:text-white/70",
        ].join(" ")}
        style={align === "right" ? { minWidth: "48px" } : undefined}
      >
        <span>{label}</span>
        {active &&
          (sortDir === "desc" ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          ))}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{
          maxWidth: "680px",
          background: "rgba(13,17,23,0.97)",
          borderColor: "rgba(96,165,250,0.2)",
        }}
      >
        {/* En-tête */}
        <div className="shrink-0 border-b border-white/10 px-6 py-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
            {t("loadout.pickerConfigTitle")}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-base uppercase tracking-wide" style={{ color: "#60a5fa" }}>
              {portLabel}
            </span>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.25)",
                color: "#60a5fa",
              }}
            >
              S{slot.slotSize}
            </span>
            <span className="text-[10px] font-semibold uppercase text-white/40">
              {t("loadout.pickerComponentCount", { count: filtered.length })}
            </span>
            {sortKey != null && (
              <button
                onClick={() => setSortKey(null)}
                className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/60 transition-colors hover:bg-white/10"
                title={t("loadout.pickerRegroupTitle")}
              >
                {t("loadout.pickerRegroup")}
              </button>
            )}
            {isMount && (
              <button
                onClick={onClear}
                className="ml-auto rounded-full border px-3 py-1 text-[10px] font-semibold uppercase transition-opacity hover:opacity-90"
                style={{
                  color: "rgba(255,170,80,0.95)",
                  border: "1px solid rgba(255,136,0,0.3)",
                  background: "rgba(255,136,0,0.08)",
                }}
              >
                {t("loadout.pickerLeaveEmpty")}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label={t("loadout.pickerClose")}
              className={`${isMount ? "" : "ml-auto"} rounded-lg p-1 text-white/50 hover:bg-white/10`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isMount && (
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,136,0,0.75)" }}>
              {t("loadout.pickerMountHint", { mount: slot.slotType === "MISSILE" ? t("loadout.pickerMissileRack") : t("loadout.pickerCarrier") })}
            </div>
          )}
        </div>

        {/* Recherche */}
        <div className="shrink-0 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("loadout.pickerSearchPlaceholder")}
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
            />
          </div>
          {/* Filtres d'acquisition (Lot 5) : tous / achetables / craftables */}
          <div className="mt-2.5 flex items-center gap-2">
            {([
              { key: "all", label: t("loadout.acqAll"), icon: null },
              { key: "buy", label: t("loadout.acqBuy"), icon: ShoppingCart },
              { key: "craft", label: t("loadout.acqCraft"), icon: Hammer },
              { key: "stock", label: t("loadout.acqStock"), icon: Package },
            ] as const).map((chip) => {
              const active = acqFilter === chip.key;
              const Icon = chip.icon;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setAcqFilter(chip.key)}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    borderColor: active ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.1)",
                    background: active ? "rgba(96,165,250,0.15)" : "transparent",
                    color: active ? "#93c5fd" : "rgba(255,255,255,0.55)",
                  }}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* En-têtes de colonnes */}
        {!loading && filtered.length > 0 && (
          <div
            className="flex shrink-0 items-center gap-4 px-6 py-1.5"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.05)",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <div className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t("loadout.pickerColComponent")}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {sortHeader(t("loadout.pickerColSize"), "size", "left")}
              {sortHeader(t("loadout.pickerColGrade"), "grade", "left")}
            </div>
            <div className="flex shrink-0 items-center gap-5">
              {spec.map((s) => (
                <span key={s.key}>{sortHeader(t(s.labelKey), s.key, "right")}</span>
              ))}
            </div>
          </div>
        )}

        {/* Corps */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[11px] uppercase tracking-widest text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loadout.loadingShort")}
            </div>
          ) : error ? (
            <p className="px-6 py-4 text-sm text-red-300">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/40">
              <PackageOpen className="h-9 w-9 opacity-25" />
              <span className="text-[11px] uppercase tracking-widest">{t("loadout.pickerNoCompatible")}</span>
            </div>
          ) : sortedList != null ? (
            // Tri actif : liste à plat triée (regroupement désactivé).
            sortedList.map((c) => (
              <PickerRow
                key={c.className}
                comp={c}
                specs={spec}
                current={slot.componentClassName}
                onSelect={() => onPick(c)}
                onShowAcq={(comp, kind) => setAcqDetail({ comp, kind })}
              />
            ))
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group ?? "_flat"}>
                {group && (
                  <div
                    className="sticky top-0 px-6 py-2 text-[10px] font-semibold uppercase tracking-widest"
                    style={{
                      color: "rgba(96,165,250,0.6)",
                      background: "rgba(13,17,23,0.97)",
                      borderBottom: "1px solid rgba(96,165,250,0.07)",
                    }}
                  >
                    {group}
                  </div>
                )}
                {items.map((c) => (
                  <PickerRow
                    key={c.className}
                    comp={c}
                    specs={spec}
                    current={slot.componentClassName}
                    onSelect={() => onPick(c)}
                    onShowAcq={(comp, kind) => setAcqDetail({ comp, kind })}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Pied : vider le slot */}
        <div className="shrink-0 border-t border-white/10 px-6 py-3">
          <button
            onClick={onClear}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
          >
            {t("loadout.pickerClearSlot")}
          </button>
        </div>
      </div>

      {acqDetail && (
        <AcquisitionDetailModal comp={acqDetail.comp} kind={acqDetail.kind} onClose={() => setAcqDetail(null)} />
      )}
    </div>
  );
}

function PickerRow({
  comp,
  specs,
  current,
  onSelect,
  onShowAcq,
}: {
  comp: ComponentRow;
  specs: StatSpec[];
  current: string | null;
  onSelect: () => void;
  onShowAcq: (comp: ComponentRow, kind: "buy" | "craft" | "stock") => void;
}) {
  const { t } = useTranslation();
  const isActive = comp.className != null && comp.className === current;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="flex w-full cursor-pointer items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-white/[0.04]"
      style={{
        background: isActive ? "rgba(96,165,250,0.10)" : undefined,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        borderLeft: `2px solid ${isActive ? "#60a5fa" : "transparent"}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm" style={{ color: isActive ? "#60a5fa" : "#fff" }}>
          {comp.name}
        </div>
        {(comp.manufacturer || comp.class) && (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            {[comp.manufacturer, comp.class].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/60"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          S{comp.size}
        </span>
        {comp.grade && (
          <span
            className="rounded px-1.5 py-0.5 text-center text-[10px] font-semibold"
            style={{ color: "#000", background: gradeColor(comp.grade), minWidth: "22px" }}
          >
            {comp.grade}
          </span>
        )}
      </div>
      {/* Acquisition (Lot 5) : icônes cliquables → mini-modale détail. Grisé si donnée inconnue. */}
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <AcqIcon
          Icon={ShoppingCart}
          on={comp.buyable === 1}
          color="#34d399"
          label={comp.buyable === 1 ? t("loadout.acqBuy") : t("loadout.acqNotBuy")}
          onShow={() => onShowAcq(comp, "buy")}
        />
        <AcqIcon
          Icon={Hammer}
          on={comp.craftable === 1}
          color="#fbbf24"
          label={comp.craftable === 1 ? t("loadout.acqCraft") : t("loadout.acqNotCraft")}
          onShow={() => onShowAcq(comp, "craft")}
        />
        <AcqIcon
          Icon={Package}
          on={!!comp.stockShips}
          color="#93c5fd"
          label={comp.stockShips ? t("loadout.acqStock") : t("loadout.acqNotStock")}
          onShow={() => onShowAcq(comp, "stock")}
        />
      </div>
      <div className="flex shrink-0 items-center gap-5">
        {specs.map((s) => (
          <div key={s.key} className="text-right" style={{ minWidth: "48px" }}>
            <div className="font-mono text-[12px] text-white">{formatStat(getStat(comp, s.key), s)}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t(s.labelKey)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Icône d'acquisition cliquable (agrandie). Active (colorée, ouvre le détail) si la source
// existe ; sinon grisée et inerte. stopPropagation pour ne pas sélectionner le composant.

export { ComponentPickerModal, PickerRow };
