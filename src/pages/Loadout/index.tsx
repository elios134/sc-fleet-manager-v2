import Dropdown from "../../components/ui/Dropdown";
import { Check, Loader2 } from "lucide-react";
import MiningPlanner from "../../components/loadout/MiningPlanner";
import SalvagePlanner from "../../components/loadout/SalvagePlanner";
import { ProvenanceContext } from "./components/ProvenanceChip";
import { StatBar, EnergyPips, LoadoutCost } from "./components/LoadoutPanels";
import { SECTIONS, groupRoots } from "./helpers";
import { ShipBanner } from "./components/ShipBanner";
import { CategorySection } from "./components/CategorySection";
import { SlotTree, LoadoutNode } from "./components/SlotTree";
import { PerformanceSummary } from "./components/PerformanceSummary";
import { ComponentPickerModal } from "./components/ComponentPickerModal";
import { ShoppingListPanel } from "./components/ShoppingListPanel";
import { useShoppingCart } from "./hooks/useShoppingCart";
import { useMapContext } from "../../components/starmap3d/useMapContext";

import { useLoadoutPage } from "./hooks/useLoadoutPage";
export default function LoadoutPage() {
  const {
    t,
    dirty,
    fleetShips,
    catalogShips,
    activeShipId,
    planner,
    setPlanner,
    previewShipDataId,
    editSlots,
    setModalMembers,
    saving,
    loading,
    error,
    loadShip,
    loadCatalogShip,
    save,
    openPicker,
    pickComponent,
    clearSlot,
    modalIndex,
    modalSlot,
    isPreview,
    hasSelection,
    isRented,
    provenance,
    costItems,
    activeShipDataId,
    activeShipMeta,
    blocker,
    childIdxByParent,
    isRootSlot,
  } = useLoadoutPage();
  const map = useMapContext();
  const cart = useShoppingCart(activeShipId);
  return (
    <ProvenanceContext.Provider value={provenance}>
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("loadout.subtitlePrefix")}</p>
        <h1 className="text-2xl font-bold text-white">{t("loadout.title")}</h1>
      </header>

      {/* Sous-onglets : Composants (base) / Minage / Salvage */}
      <div className="mb-6 inline-flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
        {([
          ["components", t("loadout.tab.components")],
          ["mining", t("loadout.tab.mining")],
          ["salvage", t("loadout.tab.salvage")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPlanner(key)}
            className={[
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              planner === key ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-white/50 hover:text-white/80",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {planner === "mining" ? (
        <MiningPlanner />
      ) : planner === "salvage" ? (
        <SalvagePlanner />
      ) : loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loadout.loadingShort")}
        </div>
      ) : (
        <>
          {error && (
            <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Colonne gauche ~65% */}
            <div className="lg:w-[65%]">
              {/* Sélecteur ship : deux groupes — Ma flotte / Catalogue (réplique V1) */}
              <Dropdown
                value={
                  activeShipId != null
                    ? `fleet:${activeShipId}`
                    : isPreview
                      ? `catalog:${previewShipDataId}`
                      : ""
                }
                onChange={(val) => {
                  if (val.startsWith("fleet:")) void loadShip(Number(val.slice(6)));
                  else if (val.startsWith("catalog:")) void loadCatalogShip(Number(val.slice(8)));
                }}
                placeholder={t("loadout.noShipOption")}
                searchable
                searchPlaceholder={t("common.searchPlaceholder")}
                className="mb-4 w-full max-w-md"
                buttonClassName="rounded-xl px-3 py-2.5"
                ariaLabel={t("loadout.noShipOption")}
                groups={[
                  ...(fleetShips.length > 0
                    ? [
                        {
                          label: t("loadout.groupMyFleet"),
                          options: fleetShips.map((s) => ({
                            value: `fleet:${s.id}`,
                            label: `${s.name} — ${s.manufacturer}`,
                          })),
                        },
                      ]
                    : []),
                  ...(catalogShips.length > 0
                    ? [
                        {
                          label: t("loadout.groupCatalog2"),
                          options: catalogShips.map((s) => ({
                            value: `catalog:${s.id}`,
                            label: `${s.name} — ${s.manufacturer}`,
                          })),
                        },
                      ]
                    : []),
                ]}
              />

              {hasSelection && (
                <>
                  {/* Bandeau mode aperçu (vaisseau du catalogue, non possédé) */}
                  {isPreview && (
                    <div
                      className="mb-4 rounded-xl border px-4 py-2.5 text-sm"
                      style={{
                        background: "rgba(255,136,0,0.08)",
                        borderColor: "rgba(255,136,0,0.3)",
                        color: "rgba(255,170,80,0.95)",
                      }}
                    >
                      <strong>{t("loadout.previewModeTitle")}</strong> — {t("loadout.previewModeDesc")}
                    </div>
                  )}
                  {/* Vaisseau loué : loadout de base non modifiable */}
                  {isRented && !isPreview && (
                    <div
                      className="mb-4 rounded-xl border px-4 py-2.5 text-sm"
                      style={{
                        background: "rgba(96,165,250,0.08)",
                        borderColor: "rgba(96,165,250,0.3)",
                        color: "rgba(147,197,253,0.95)",
                      }}
                    >
                      <strong>{t("loadout.rentedReadonlyTitle")}</strong> — {t("loadout.rentedReadonlyDesc")}
                    </div>
                  )}
                  {/* Sauvegarde auto : bouton visible uniquement quand un changement est détecté ;
                      sinon, simple indicateur « Enregistré ». Plus de gestion manuelle de profils. */}
                  {!isPreview && !isRented && (
                    <div className="mb-5 flex items-center justify-end">
                      {dirty ? (
                        <button
                          onClick={() => void save()}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          {saving ? t("loadout.savingShort") : t("loadout.saveBtn")}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-sm text-white/40">
                          <Check className="h-4 w-4 text-emerald-400" />
                          {t("loadout.savedLabel")}
                        </span>
                      )}
                    </div>
                  )}

                  <StatBar slots={editSlots} />
                  {/* Bandeau image top-down du vaisseau */}
                  <ShipBanner ship={activeShipMeta} />

                  {/* Sections de slots */}
                  {editSlots.length === 0 ? (
                    <p className="text-sm text-white/40">
                      {t("loadout.noHardpoints2")}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
                      {SECTIONS.map((section) => {
                        const rootEntries = editSlots
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => section.types.includes(s.slotType) && isRootSlot(s))
                          // Tri par taille décroissante (convention erkul). Tri stable :
                          // les slots de même taille gardent l'ordre backend (gauche/droite…).
                          .sort((a, b) => b.s.slotSize - a.s.slotSize);
                        if (rootEntries.length === 0) return null;
                        // Compteur = items équipables (feuilles), hors conteneurs de tourelle :
                        // pour le Hammerhead on annonce 24 armes, pas 6 tourelles.
                        const leafCount = editSlots.filter(
                          (s) =>
                            section.types.includes(s.slotType) &&
                            s.slotType !== "TURRET" &&
                            (s.hardpointId == null ||
                              (childIdxByParent.get(s.hardpointId)?.length ?? 0) === 0),
                        ).length;
                        // Sections arborescentes (armes / tourelles / missiles) : rendu erkul
                        // via LoadoutNode (hiérarchie déroulée mount→arme, regroupement ×N).
                        // Systèmes / propulsion : feuilles simples via SlotTree.
                        const isTreeSection = section.types.some((tp) =>
                          ["WEAPON", "TURRET", "MISSILE"].includes(tp),
                        );
                        const families = section.types.includes("MISSILE")
                          ? ["MISSILE"]
                          : ["WEAPON", "TURRET"];
                        const groups = isTreeSection
                          ? []
                          : groupRoots(rootEntries, editSlots, section.disableGrouping);
                        return (
                          <div key={section.titleKey} className={section.fullWidth ? "lg:col-span-2" : ""}>
                            <CategorySection
                              title={t(section.titleKey)}
                              icon={section.icon}
                              count={leafCount}
                              variant={section.variant}
                              collapsible={section.collapsible}
                            >
                              {isTreeSection
                                ? rootEntries.map(({ idx }) => (
                                    <LoadoutNode
                                      key={idx}
                                      rep={idx}
                                      members={[idx]}
                                      mult={1}
                                      families={families}
                                      variant={section.variant}
                                      editSlots={editSlots}
                                      childIdxByParent={childIdxByParent}
                                      selectedIdx={modalIndex}
                                      onPick={openPicker}
                                    />
                                  ))
                                : groups.map((g) => (
                                    <SlotTree
                                      key={g.idx}
                                      idx={g.idx}
                                      variant={section.variant}
                                      editSlots={editSlots}
                                      childIdxByParent={childIdxByParent}
                                      selectedIdx={modalIndex}
                                      onSelect={isRented ? () => {} : (idx) => openPicker([idx])}
                                      groupCount={g.count}
                                    />
                                  ))}
                            </CategorySection>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Colonne droite ~35% */}
            <div className="lg:w-[35%]">
              <EnergyPips slots={editSlots} />
              <LoadoutCost items={costItems} />
              {!isPreview && activeShipId != null && <ShoppingListPanel cart={cart} map={map} />}
              <PerformanceSummary slots={editSlots} ship={activeShipMeta} />
            </div>
          </div>
        </>
      )}

      {modalSlot && (
        <ComponentPickerModal
          slot={modalSlot}
          shipDataId={activeShipDataId}
          isMount={
            modalSlot.hardpointId != null &&
            (childIdxByParent.get(modalSlot.hardpointId)?.length ?? 0) > 0
          }
          onPick={pickComponent}
          onClear={clearSlot}
          onClose={() => setModalMembers([])}
          map={map}
          cart={cart}
          slotKey={modalSlot.hardpointId != null ? `hp-${modalSlot.hardpointId}` : modalSlot.portName}
        />
      )}

      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => blocker.reset?.()}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-white/12 p-5"
            style={{ background: "rgba(13,17,23,0.98)" }}
          >
            <h3 className="mb-1.5 text-base font-semibold text-white">{t("loadout.leaveTitle")}</h3>
            <p className="mb-4 text-sm text-white/60">{t("loadout.leaveDesc")}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => blocker.reset?.()}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
              >
                {t("loadout.leaveCancel")}
              </button>
              <button
                onClick={() => blocker.proceed?.()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "#f87171" }}
              >
                {t("loadout.leaveConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ProvenanceContext.Provider>
  );
}

/* ── Sous-composants ── */

// Bandeau image top-down du vaisseau (réplique ShipBanner.tsx V1, ratio ~2.5:1).
