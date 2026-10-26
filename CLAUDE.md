# CLAUDE.md — SC Fleet Manager v2

Guide de travail pour Claude sur ce dépôt. Tauri v2 + React 19 + TypeScript + Rust/SQLite.

## Règles générales

- **Ne jamais lancer l'app soi-même** (refontes UI = maquettes/artifacts). Vérification =
  `npx tsc --noEmit` (front) + `cargo check` (dans `src-tauri/`).
- Ne committer qu'une feature **validée**, jamais les états intermédiaires.
- SQL toujours paramétré (`.bind`), jamais d'interpolation de valeur utilisateur.
- i18n : clés plates dans `src/i18n/locales/{fr,en}.json`.
- tsconfig strict (`noUnusedLocals`/`noUnusedParameters`) → supprimer tout code mort.

---

## 🚧 Chantier en cours : découpage des gros fichiers

**But** : scinder les fichiers > ~400 lignes en modules cohérents. Objectif =
lisibilité/maintenabilité, **pas** une fausse réutilisation.

### Cibles de taille (indicatives, pas un lint bloquant)

| Type de fichier            | Cible      | Plafond souple |
| -------------------------- | ---------- | -------------- |
| Composant UI               | 80–150     | ~250           |
| Page (orchestration)       | 150–250    | ~350           |
| Hook / lib pure            | 100–200    | ~300           |
| Registre / config (données)| —          | pas de limite  |

### Principes d'architecture

- **Une page = un dossier** co-localisé (`pages/Xxx/index.tsx` + `components/` + `hooks/` +
  `types.ts`). L'`index.tsx` orchestre (layout + état haut niveau + data-load).
- Sortir dans `src/components/` (ou `src/lib/`, `src/hooks/`) **uniquement** ce qui est
  utilisé par **≥ 2 pages**. Sinon rester local → éviter les imports croisés page↔page.
- Chaque lot = **déplacement pur, zéro changement de comportement**, `tsc` vert, committable.

### Méthode par page

1. Extraire les sous-composants/hook/types dans le dossier de la page.
2. `npx tsc --noEmit` doit rester vert (corriger imports / code mort).
3. Committer (`refactor(<page>): découpage en modules`).
4. **Mettre à jour ce fichier** (case cochée + notes).

### Ordre & suivi

Lignes de départ (avant découpage) :

- [x] **SettingsPage** — 3338 l. → `pages/Settings/` : `index.tsx` (80) + `types.ts` +
      `syncTypes.ts` + `hooks/useDonneesSync.ts` + `components/*` + `sections/*.tsx`.
      Lot 1 (par onglet) + lot 2 (sous-découpe) faits. **Refonte v3.2 (oct. 2026)** : page à
      sections (`sections.ts`, `panels/*Panel.tsx`, `panels/data|game/*`, `hooks/useDataSync.ts`) ;
      `DonneesTab` éclaté (santé / sources / synchro avancée). Tous les fichiers < ~300 l.
- [x] **LoadoutPage** — 2259 l. → `pages/Loadout/` : `index.tsx` (536) + `types.ts` +
      `helpers.ts` + `components/*` (ShipBanner, CategorySection, SlotTree, PerformanceSummary,
      AcquisitionDetailModal, ComponentPickerModal, AcqIcon). Restent > cible : `index`
      (composant page 536) et `ComponentPickerModal` (482) — sous-découpe optionnelle.
- [x] **CargoRoutesPage** — 1890 l. → `pages/CargoRoutes/` : `index.tsx` (121) + `types.ts`
      + `helpers.ts` + `components/*` (ContextBar, ToolRail, ConvoyStrip, RouteCard, RouteMap,
      AffluenceBadge, FuelBadge, Field, RouteRow) + `tools/*` (PlannerTab, LoopPlannerTab,
      GpsTradingTab). Types partagés importés par `components/CargoGridTab`,
      `RouteDetailsModal`, `TripMapModal` → `CargoRoutes/types`. Reste > cible :
      `GpsTradingTab` (687) — sous-découpe optionnelle.
- [x] **CraftingHubPage** — 1865 l. → `pages/CraftingHub/` : `index.tsx` (474) + `types.ts`
      + `helpers.ts` (258) + `components/*` (IngredientRow, SlotBlock, BlueprintThumb,
      BlueprintRow, DataRow, IngredientMiningModal, BlueprintDetailPanel 508). Reste > cible :
      `index` (page 474) et `BlueprintDetailPanel` (508) — sous-découpe optionnelle.
- [x] **DashboardPage** — 1431 l. → `pages/Dashboard/` : `index.tsx` (395) + `types.ts`
      + `widgets.ts` (registre WIDGETS + constantes de tailles) + `helpers.ts` + `components/*`
      (FreeWidget, WidgetBody, WidgetLibraryModal, boxes, EmptyState + 7 bodies :
      Insurance/Missions/Ccu/Locations/Routes/RsiStatus/News). Reste > cible : `index`
      (page 395, orchestration data-load dense) — sous-découpe optionnelle.
- [x] **CcuChainPage** — 1153 l. → `pages/CcuChain/` : `index.tsx` (378) + `types.ts`
      + `helpers.ts` (fmt prix/TVA, âge relatif) + `components/*` (Header, ShipSelectorPair,
      ShipPickerModal 221, StatsRow, SortButton, ChainFlow, PathCard). Le multiplicateur
      de TVA d'affichage passe d'un `let` module à un objet `{ mult }` (réassignable via
      un import const). Reste > cible : `index` (378) et `ShipPickerModal` (221) — optionnel.

Déjà partagé/extrait : `TitleBar`, `CargoGridTab`, `missionShared` (types/helpers/modale).

### Journal

- **SettingsPage** découpée en `pages/Settings/` (`tsc` vert, déplacement pur). Router
  mis à jour (`../pages/Settings`).
- **Lot 2 Settings** : `ComptesTab` 542→377 (modales → `components/AccountModals`),
  `DataminingTab` 499→189 (`GameLogCard`/`OverlayCard`/`Badge` → `components/`),
  `DonneesTab` 1112→811 (store+hook → `hooks/useDonneesSync`, rows → `components/SourceRow`,
  types → `syncTypes`). Reste : éclater le rendu du composant `DonneesTab`.
- **LoadoutPage** découpée en `pages/Loadout/` (10 fichiers, `tsc` vert, déplacement pur).
  Router mis à jour (`../pages/Loadout`).
- **CargoRoutesPage** découpée en `pages/CargoRoutes/` (15 fichiers, `tsc` vert, déplacement
  pur). Router + 3 imports de types externes mis à jour (`CargoRoutes/types`).
- **CraftingHubPage** découpée en `pages/CraftingHub/` (10 fichiers, `tsc` vert, déplacement
  pur). Router mis à jour (`../pages/CraftingHub`).
- **DashboardPage** découpée en `pages/Dashboard/` (18 fichiers, `tsc` vert, déplacement pur).
  Registre `WIDGETS` isolé dans `widgets.ts` ; un fichier par widget-body. Router mis à jour.
- **CcuChainPage** découpée en `pages/CcuChain/` (10 fichiers, `tsc` vert). Router mis à jour.
  Seul écart : le multiplicateur TVA d'affichage devient un objet `{ mult }` (contrainte
  modules ES : un import `const` reste mutable, un `let` importé non).

**🎉 Chantier terminé** : les 6 gros fichiers (Settings, Loadout, CargoRoutes, CraftingHub,
Dashboard, CcuChain) sont découpés en dossiers `pages/Xxx/`.

**Passe dette technique (v3.2, oct. 2026)** — déplacements purs, `tsc` / tests / clippy verts :
- Front : `MissionHubPage` + `missionShared` → `pages/MissionHub/` ; `ShipWalk` → ShipWalk +
  WalkModel + ShipLights + walkPhysics ; `GpsTradingTab` → hook `useGpsTrip` + GpsParams +
  GpsNavigation ; Loadout / CraftingHub : état extrait en `hooks/` ; `BlueprintDetailPanel` →
  hook + `BlueprintTabs` ; modales Assurance, `PickerRow`, `cargoGrid/`, `starmap3d/stations.tsx`.
  Plus aucun fichier front > ~440 l.
- Rust : `cargo_routes`, `wiki_sync`, `datamining`, `fleet`, `ccu_chain`, `crafting_hub`,
  `datamining_extract`, `catalog`, `gamelog` passés en dossiers `xxx/mod.rs` + sous-modules
  (plus aucun fichier > ~750 l.). Règle : un sous-module fait `use super::*;`, ses éléments
  sont `pub(crate)`, et `mod.rs` déclare les sous-modules **en fin de fichier** (les
  `macro_rules!` locales doivent les précéder). Une commande `#[tauri::command]` déplacée
  dans un sous-module s'enregistre sous son nouveau chemin dans `main.rs`
  (ex. `commands::fleet::sync::sync_fleet_from_scrape`).
- Tests ajoutés sur la logique pure des pages (Missions, Carnet, Flotte, CCU, Crafting,
  Loadout, catalogue).

---

## Vaisseaux 3D (état v3.3, oct. 2026)

- **asset-3D = vérité absolue** pour tout ce qui est 3D (repo `elios134/asset-3d`, local
  `../asset-3D`) : modèles `.glb` sur la release `sc-4.1`, `index.json` sur `main`, règles
  d'exclusion dans `app/src/shared/excludeRules.mjs` + `exclusions.json`. L'app ne fait que lire.
- **Deux rendus** (`ShipRender = "clay" | "painted"`, `src/lib/ship3d.ts`) : Clay (résine grise,
  matcap) et Peint (couleurs du jeu cuites en couleurs de sommets, 1 matériau partagé → aussi
  fluide que le clay). Défaut : Peint, choix mémorisé (`ship3d.render`). Le clay sert de repli
  pendant le chargement du peint. Le rendu texturé et les lumières ont été **abandonnés**
  (surcoût de draw calls, recompilations de shaders) : ne pas les réintroduire.
- **Index** : une variante par (niveau, rendu) ; le clay reste **en premier** par niveau (les
  versions ≤ 3.2 prennent la 1re variante). Jamais de peint sans clay publié au même niveau.
- **Mode dev** : sous `npm run tauri dev` (`cfg(debug_assertions)` côté Rust), l'app lit
  `../asset-3D/index.dev.json` et les `.glb` locaux (`ship3d_dev_index`, `get_ship_model`).
  Générer l'index local : `node scripts/publish.mjs --only=... --painted --dev-index` dans asset-3D.
- **Perf three.js** : ne jamais basculer `visible` sur une lumière (recompile tous les shaders) ;
  précompiler avec `gl.compile(scene, camera)`.

---

## Pages « liste + fiche » (état v3.4, oct. 2026)

- Modèle commun : `components/ui/SidePanel.tsx` (`SidePanelLayout`, fiche fixe 440 px, 520 px en 2xl,
  qui passe sous la liste sous 1024 px) — Catalogue, Cosmétiques, CCU (liste de souhaits), Minage
  (bilan du work order). **Ma flotte** fait exception à la demande d'André : tableau pleine largeur et
  fiche en fenêtre (`ShipDetailsModal`, fiche partagée `components/ship/ShipDetailsBody.tsx`).
- Logique pure de chaque page dans `pages/Xxx/lib/*.ts` avec tests à côté (`cosmetics`,
  `fleetView`, `chain`, `steps`).
- `Dropdown` : une option au libellé enrichi (ReactNode) donne son texte de recherche via `searchText`.
- Page 3D ouvrable sur un vaisseau : `?ship=<id ShipData>`.
