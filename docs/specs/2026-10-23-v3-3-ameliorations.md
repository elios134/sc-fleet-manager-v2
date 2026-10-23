# Améliorations v3.3 — états vides, carte, Loadout ↔ Catalogue, Crafting ↔ Minage, Inventaire, Comparateur (spec)

Validée par André le 23/10/2026 (maquette `docs/design/maquettes-v3.3.html`).

## Objectif
Rendre l'app utilisable dès le premier lancement (plus d'écran vide sans action) et relier
les onglets entre eux (acheter ce qu'il manque à un loadout, miner ce qu'il manque à un plan,
retrouver un objet, comparer des loadouts). Réussi quand chaque parcours de la maquette marche
de bout en bout avec les vraies données, sans écran blanc.

## Ce qui existe déjà (vérifié)
- **Prix des composants** : `Component.wikiId` = `ItemPrice.itemUuid` (catalogue UEX). 299
  composants ont au moins un prix d'achat (armes 90/593, boucliers 39/65, générateurs 35/77,
  refroidisseurs 44/71, moteurs quantiques 44/57). Terminal → lieu via `UexTerminal`.
- **Position du joueur** : `positionBody` (carte) depuis `gamelog.currentLocation`.
- **Itinéraire** : `useItinerary` (localStorage `starmap.itinerary`), `stopPoint`, `legOf`, `fuelLegs`.
- **Inventaire** : `InventoryState.json` → possessions par lieu (`classe → { qte, vu }`), noms via
  `inventory_item_meta`. Objets seulement : **pas** de minerais en SCU.
- **Minage** : `get_ingredient_mining_locations(ref)` (lieux, méthode, rareté) par ingrédient.
- **Loadouts** : `get_loadouts_by_ship` (profils + slots), stats via `aggregateLoadoutStats`,
  signature `ShipData.crossSection`. Comparateur actuel : vaisseaux seulement (`compare.ts`).
- **Échelle RSI** : distance RSI × 14,96 = distance réelle en Gm (Hurston 0,859 → 12,85 ;
  Crusader 1,28 → 19,15 ; ArcCorp 1,933 → 28,92).
- **Fraîcheur des données** : `dataFreshnessSummary` / `useSettingsStatus` (Réglages).

## Fonctionnalités

### 1. États vides et premiers pas (écran 1)
- Composant commun `EmptyState` (icône, titre, texte, action principale, action secondaire).
- Appliqué quand la donnée manque : routes cargo (prix UEX), carte (corps), CCU (catalogue),
  inventaire (pas de lecture), crafting (plans), catalogue (objets), missions.
- Carte « Premiers pas » sur l'accueil : 5 étapes (compte RSI, données Wiki, prix UEX, carte,
  Game.log), cochées depuis l'état réel ; chaque étape lance la synchro ou ouvre le réglage.
  Disparaît quand tout est fait ; masquable (AppMeta `ui.firstStepsDismissed`).
- Pastille de fraîcheur « Prix d'il y a … » sur Cargo et Catalogue (seuils de Réglages).

### 2. Carte : petits ratés (écran 2)
- **Saut entre systèmes** : `legOf` renvoie les deux moitiés (`out`, `in`) ; `fuelLegs` vérifie
  chaque moitié séparément, réservoir plein à la Gateway. Affichage en deux lignes + badge
  « Ravitaillement possible ».
- **Nyx (et tout système sans géométrie)** : distance estimée depuis la position RSI
  (distance × 14,96 Gm, longitude) ; affichée « ≈ » + badge « estimation » ; le total reste « ≥ »
  si une étape est encore inconnue.
- **Levski** : station Wiki rattachée au corps RSI dont le nom figure dans la sienne ou à un
  alias (`Levski → Delamar`), avant le repli « planète la plus proche ».
- **Carte GPS de l'onglet Cargo** : bouton « Route seulement / Toutes les stations » ; par
  défaut seules les stations de la route sont dessinées.

### 3. Loadout ↔ Catalogue (écran 3)
- Dans le sélecteur de composant : colonne « Où l'acheter » (terminal le plus proche, distance
  depuis la position, prix), tri Plus proche / Moins cher / Meilleur. « Non vendu en boutique »
  si aucun prix.
- Liste d'achats par vaisseau (localStorage `loadout.cart.<shipId>`) : composant, terminal,
  prix ; total et nombre d'arrêts. « Créer l'itinéraire d'achats » remplace l'itinéraire de la
  carte (départ = position), ordre optimisé, puis ouvre la carte.

### 4. Crafting ↔ Minage (écran 4)
- Onglet Craft : quantité à fabriquer (1–99) ; par ingrédient : besoin, possédé, manque.
  Possédé = saisie libre (localStorage `crafting.owned.<ref>`), pré-remplie par l'inventaire
  Game.log quand la classe de l'objet y figure.
- Plan de minage : pour chaque minerai manquant, lieux triés (méthode choisie ROC / Vaisseau /
  À pied d'abord, puis distance) ; un lieu choisi par minerai. « Créer l'itinéraire de minage ».

### 5. Inventaire « Où est mon… ? » (écran 5)
- Recherche par nom (texte trouvé surligné), filtres Tout / Armes / Armures / Outils (catégorie
  de `inventory_item_meta`), 5 recherches récentes (localStorage).
- Fiche d'un objet : lieux, quantité, dernière lecture ; mini-carte ; « Voir sur la carte »
  (sélectionne le corps) et « Ajouter à l'itinéraire ».

### 6. Comparateur de loadouts (écran 6)
- Mode « Loadouts » à côté de « Vaisseaux » : jusqu'à 3 colonnes (vaisseau + profil, stock
  inclus) ; la 1re est la référence.
- Barres par stat (DPS, alpha, bouclier HP, régén., délai, marge d'énergie, signature) avec écart
  en % (vert = mieux selon le sens de la stat) ; tableau des différences d'équipement.

## Architecture
- **Logique pure (lib + tests)** : `starmap3d/itinerary.ts` (moitiés de saut, estimation RSI),
  `lib/emptyState.ts` (étapes des premiers pas), `pages/Loadout/lib/shopping.ts` (meilleure
  offre, tri, liste d'achats → arrêts), `pages/CraftingHub/lib/missing.ts` (besoin / manque,
  tri des lieux), `pages/Inventory/lib/search.ts` (recherche, filtres, regroupement),
  `pages/Comparator/lib/loadouts.ts` (stats, écarts, différences).
- **Adaptateurs Rust** : `get_component_offers(componentIds)` (prix + terminal + lieu, SQL
  paramétré) ; Levski : alias dans `starmap_wiki_stations` ; `get_comparable_loadouts(shipIds)`
  si les commandes existantes ne suffisent pas.
- **Interface** : `src/components/ui/EmptyState.tsx` (partagé), carte Premiers pas (Home), colonnes
  et panneau du sélecteur (Loadout), onglet Craft, page Inventaire, mode du Comparateur.

## Erreurs et cas limites
- Hors ligne / pas de synchro : `EmptyState` avec l'action de synchro, jamais d'écran blanc.
- Position inconnue : tri « Plus proche » remplacé par « Moins cher », distance « — ».
- Composant non vendu : ligne grisée « Non vendu en boutique », pas dans la liste d'achats.
- Inventaire jamais lu : `EmptyState` « Ouvre ton inventaire en jeu ».
- Minerai sans lieu connu : « Aucun lieu connu » + lien vers l'onglet Minage.
- Double clic sur une synchro : bouton désactivé pendant la synchro.

## Sécurité et confidentialité
Aucune nouvelle donnée envoyée au réseau : tout vient des tables déjà synchronisées et du
Game.log local. SQL paramétré.

## Hors périmètre
Prix en temps réel, achat automatique, minerais en SCU dans l'inventaire (absents du Game.log),
comparaison de plus de 3 loadouts.

## Vérification
- Tests unitaires : moitiés de saut et carburant, estimation RSI, étapes des premiers pas,
  meilleure offre / tri / arrêts, besoin / manque / tri des lieux, recherche inventaire,
  écarts du comparateur, alias Levski (Rust).
- `tsc`, `npm test`, `cargo test`, clippy, `vite build` au vert.
- Essai réel (par André) : premier lancement sur base vide, puis chaque parcours de la maquette.
