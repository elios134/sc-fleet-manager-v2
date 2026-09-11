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
      `components/Section.tsx` + `sections/*.tsx` (1 onglet/fichier). ⚠️ à sous-découper
      (lot 2) : `DonneesTab` (1112 : sortir store/hook + SourceRow/FreshnessPill),
      `ComptesTab` (542 : sortir les 2 modales), `DataminingTab` (499 : sortir
      GameLogCard + OverlayCard).
- [ ] **LoadoutPage** — 2259 l.
- [ ] **CargoRoutesPage** — 1890 l. → `pages/CargoRoutes/` (context + components + tools)
- [ ] **CraftingHubPage** — 1865 l. → `pages/CraftingHub/` (components + tabs + hooks)
- [ ] **DashboardPage** — 1431 l. → `pages/Dashboard/` (widgets/ + Canvas)
- [ ] **CcuChainPage** — 1153 l.

Déjà partagé/extrait : `TitleBar`, `CargoGridTab`, `missionShared` (types/helpers/modale).

### Journal

- **SettingsPage** découpée en `pages/Settings/` (12 fichiers, `tsc` vert, déplacement
  pur). Router mis à jour (`../pages/Settings`). Reste 3 sous-découpes notées ci-dessus.
