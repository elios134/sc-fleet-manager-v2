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
      Lot 1 (par onglet) + lot 2 (sous-découpe) faits. Tous < ~380 l. SAUF le **composant
      `DonneesTab` (811)** : le réduire = éclater son rendu en sous-panneaux
      (Wiki/Cargo/UEX/CCU) — refonte plus profonde, à faire à part.
- [ ] **LoadoutPage** — 2259 l.
- [ ] **CargoRoutesPage** — 1890 l. → `pages/CargoRoutes/` (context + components + tools)
- [ ] **CraftingHubPage** — 1865 l. → `pages/CraftingHub/` (components + tabs + hooks)
- [ ] **DashboardPage** — 1431 l. → `pages/Dashboard/` (widgets/ + Canvas)
- [ ] **CcuChainPage** — 1153 l.

Déjà partagé/extrait : `TitleBar`, `CargoGridTab`, `missionShared` (types/helpers/modale).

### Journal

- **SettingsPage** découpée en `pages/Settings/` (`tsc` vert, déplacement pur). Router
  mis à jour (`../pages/Settings`).
- **Lot 2 Settings** : `ComptesTab` 542→377 (modales → `components/AccountModals`),
  `DataminingTab` 499→189 (`GameLogCard`/`OverlayCard`/`Badge` → `components/`),
  `DonneesTab` 1112→811 (store+hook → `hooks/useDonneesSync`, rows → `components/SourceRow`,
  types → `syncTypes`). Reste : éclater le rendu du composant `DonneesTab`.
