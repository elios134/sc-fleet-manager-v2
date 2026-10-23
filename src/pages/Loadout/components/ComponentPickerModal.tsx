import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronUp, Loader2, PackageOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { humanizePortName } from "../../../lib/loadoutSlots";
import { SLOT_TYPE_SPECS, type SlotEdit, type ComponentRow } from "../types";
import { gradeRank, deriveWeaponType, getStat } from "../helpers";
import { AcquisitionDetailModal } from "./AcquisitionDetailModal";
import type { MapContext } from "../../../components/starmap3d/useMapContext";
import { useComponentOffers } from "../hooks/useComponentOffers";
import type { ShoppingCart as Cart } from "../hooks/useShoppingCart";
import { bestOffer, offerPlace, sortComponents, type OfferSort, type PlacedOffer } from "../lib/shopping";
import { OfferCell } from "./OfferCell";
import { PickerFilters, type AcqFilter } from "./PickerFilters";
import { PickerHeader } from "./PickerHeader";

import { PickerRow } from "./PickerRow";
function ComponentPickerModal({
  slot,
  shipDataId,
  isMount,
  onPick,
  onClear,
  onClose,
  map,
  cart,
  slotKey,
}: {
  slot: SlotEdit;
  shipDataId: number | null;
  isMount: boolean;
  onPick: (c: ComponentRow) => void;
  onClear: () => void;
  onClose: () => void;
  map: MapContext;
  cart: Cart;
  /** Clé de l'emplacement dans la liste d'achats. */
  slotKey: string;
}) {
  const { t } = useTranslation();
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Filtre d'acquisition (Lot 5) : tous / achetables / craftables / stock vaisseau.
  const [acqFilter, setAcqFilter] = useState<AcqFilter>("all");
  // Mini-modale de détail d'acquisition (clic sur une icône 🛒/🔧/📦).
  const [acqDetail, setAcqDetail] = useState<{ comp: ComponentRow; kind: "buy" | "craft" | "stock" } | null>(null);
  // Tri d'affichage (pur front). null = état GROUPÉ par sous-type (défaut à l'ouverture).
  const [sortKey, setSortKey] = useState<keyof ComponentRow | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  // Tri par offre d'achat (plus proche / moins cher / meilleur) ; exclusif avec le tri de colonne.
  const [offerSort, setOfferSort] = useState<OfferSort | null>(null);
  const offers = useComponentOffers(components.map((c) => c.className), map);
  const hasPosition = map.here != null;
  const offerOf = useCallback(
    (c: ComponentRow): PlacedOffer | null => bestOffer(offers.get(c.className) ?? [], offerSort ?? (hasPosition ? "nearest" : "cheapest")),
    [offers, offerSort, hasPosition],
  );
  const inCart = cart.lineFor(slotKey);
  const offerCell = (c: ComponentRow) => {
    const o = offerOf(c);
    return (
      <OfferCell
        offer={o}
        inCart={inCart?.className === c.className}
        onToggle={() =>
          o && cart.toggle({ slot: slotKey, className: c.className, name: c.name, terminal: o.terminal, place: offerPlace(o), price: o.price, stop: o.stop })
        }
      />
    );
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Repart en état groupé (sans tri, sans filtre) à chaque changement de slot / réouverture.
    setSortKey(null);
    setSortDir("desc");
    setOfferSort(null);
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
    setOfferSort(null);
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
    if (offerSort != null) return sortComponents(filtered, offerOf, offerSort);
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
  }, [filtered, sortKey, sortDir, offerSort, offerOf]);

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
          maxWidth: "940px",
          background: "rgba(13,17,23,0.97)",
          borderColor: "rgba(96,165,250,0.2)",
        }}
      >
        <PickerHeader
          portLabel={portLabel}
          slotSize={slot.slotSize}
          count={filtered.length}
          sorted={sortKey != null || offerSort != null}
          onRegroup={() => {
            setSortKey(null);
            setOfferSort(null);
          }}
          isMount={isMount}
          missile={slot.slotType === "MISSILE"}
          onClear={onClear}
          onClose={onClose}
        />

        {/* Recherche */}
        <PickerFilters
          search={search}
          setSearch={setSearch}
          acqFilter={acqFilter}
          setAcqFilter={setAcqFilter}
          offerSort={offerSort}
          hasPosition={hasPosition}
          onOfferSort={(s) => {
            setSortKey(null);
            setOfferSort(s);
          }}
        />
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
            <div className="w-[230px] shrink-0 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t("loadout.offer.where")}
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
                offerCell={offerCell(c)}
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
                offerCell={offerCell(c)}
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

// Icône d'acquisition cliquable (agrandie). Active (colorée, ouvre le détail) si la source
// existe ; sinon grisée et inerte. stopPropagation pour ne pas sélectionner le composant.

export { ComponentPickerModal, PickerRow };
