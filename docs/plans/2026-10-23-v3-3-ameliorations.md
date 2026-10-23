# Améliorations v3.3 — plan de mise en œuvre

Spec : `docs/specs/2026-10-23-v3-3-ameliorations.md` · Maquette : `docs/design/maquettes-v3.3.html`

Règles : TDD sur la logique pure (test qui échoue d'abord), un commit par tâche validée,
`tsc` + `npm test` + `cargo test` + clippy verts à chaque tâche, i18n fr/en, jetons du thème.

## Tâche 1 — États vides et premiers pas
1. Test `lib/emptyState.test.ts` : `firstSteps(status)` → 5 étapes { done, action } depuis
   l'état réel ; `allDone`.
2. `src/components/ui/EmptyState.tsx` (icône, titre, texte, actions).
3. Carte « Premiers pas » sur l'accueil (+ masquage `ui.firstStepsDismissed`).
4. Brancher `EmptyState` : Cargo (prix), Carte, CCU, Inventaire, Crafting, Catalogue, Missions.
5. Pastille de fraîcheur sur Cargo et Catalogue.

## Tâche 2 — Carte : petits ratés
1. Tests `itinerary.test.ts` : `legOf` renvoie `parts` [aller, retour] entre systèmes ;
   `fuelLegs` par moitié avec plein à la Gateway ; `stopPoint` estimé (RSI × 14,96) marqué
   `estimated`.
2. Implémentation + affichage (deux lignes, badges « Ravitaillement possible », « estimation »).
3. Test Rust : alias `Levski → Delamar` dans `merge_wiki_stations` ; implémentation.
4. Carte GPS Cargo (TripMap3D) : bouton « Route seulement / Toutes les stations ».

## Tâche 3 — Loadout ↔ Catalogue
1. Test Rust : `group_offers` (meilleure offre par composant, tri prix) ; commande
   `get_component_offers(component_ids)` (SQL paramétré).
2. Test `pages/Loadout/lib/shopping.test.ts` : tri Plus proche / Moins cher / Meilleur,
   liste d'achats → total et arrêts uniques.
3. Colonne « Où l'acheter » dans `ComponentPickerModal` / `PickerRow` ; panneau « Liste
   d'achats » ; « Créer l'itinéraire d'achats » → itinéraire de la carte.

## Tâche 4 — Crafting ↔ Minage
1. Test `pages/CraftingHub/lib/missing.test.ts` : besoin = par recette × quantité, manque,
   tri des lieux (méthode puis distance).
2. Onglet Craft : quantité, possédé (saisie + inventaire), barre de progression.
3. Plan de minage (lieux par minerai, choix) + « Créer l'itinéraire de minage ».

## Tâche 5 — Inventaire « Où est mon… ? »
1. Test `pages/Inventory/lib/search.test.ts` : recherche insensible aux accents, filtre de
   catégorie, regroupement des lieux, récents (5 max, sans doublon).
2. Page : barre de recherche, résultats surlignés, fiche de l'objet, mini-carte, actions carte.

## Tâche 6 — Comparateur de loadouts
1. Test `pages/Comparator/lib/loadouts.test.ts` : stats par loadout, écart % selon le sens,
   différences d'équipement.
2. Mode « Loadouts » : 3 colonnes (vaisseau + profil, stock inclus), barres, tableau.

## Fin
Revue indépendante de la branche, corrections, CLAUDE.md à jour, notes de version
(`RELEASE_NOTES.md`). Pas d'envoi sans accord.
