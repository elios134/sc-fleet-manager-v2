# Données de crafting sans datamining (spec)

Validée par André le 13/11/2026 (« ok vérifie les stats puis implémente »). Lot A sans changement visuel ;
le lot B (retrait de l'extraction dans l'interface) passe par une maquette avant d'être codé.

## Objectif
Ne plus dépendre de l'extraction du Data.p4k (StarBreaker) pour les trois données qu'elle alimente
encore : stats des objets fabriqués, lieux de minage, noms français. L'appli doit donner les mêmes
données chez tous les utilisateurs, sans extraction ni dossier codé en dur.

## Ce qui existe déjà (vérifié le 13/11/2026)
- L'extraction écrit des dumps ; l'« apply » remplit `ResourceMiningLocation`,
  `CraftingBlueprint.producedItemStatsJson` et `producedItemNameFr`. Les dumps `ships/` et
  `contracts_dump` ne sont lus par personne.
- Sans extraction récente, l'apply lit `C:\Users\andre\Documents\scfleet-datamining-stable` (codé en dur).
- Base de production : `ResourceMiningLocation` vide (0 ligne), stats sur 1 555 plans sur 1 624,
  noms FR sur 1 297.
- `sync_blueprints` lit déjà, pour chaque plan, `GET /blueprints/{uuid}` puis `GET /items/{output}`.
- Comparaison sur 23 plans couvrant les 26 stats : 63 réglages de qualité sur 63 identiques au dump ;
  toutes les valeurs de base se retrouvent dans la fiche objet du wiki. 8 plans de rayon tracteur sur
  12 n'ont pas de fiche détaillée (404).
- `GET /commodities/{uuid}` donne les lieux de minage (40 ressources minables, 33 avec des lieux),
  la méthode par clé de ressource (`MineableRock_FPS_…`, `_GroundVehicle_…`, `_Asteroid…`/`_Surface…`)
  et la rareté (`…Common`, `…Uncommon`, `…Rare`, `…Epic`, `…Legendary`).
- Le wiki ne traduit pas les noms d'objets. Le pack FR installé
  (`<install>/data/Localization/french_(france)/global.ini`) donne 1 304 noms via
  `item_Name<classe>` ou `item_Name_<classe>` (classe = `producedItemEntityClass`).

## Fonctionnalités (lot A, aucun changement d'écran)
1. **Stats de craft** calculées pendant `sync_blueprints` à partir du détail du plan (`aspects` →
   `modifiers`) et de la fiche objet. Même format JSON qu'avant (lu par `src/lib/craftingStats.ts`).
   - Une entrée par (emplacement × modificateur). `slotName` = nom de l'emplacement, `slotDebugName` = sa clé.
   - `valueRanges` = `value_segments` ; s'ils sont vides, un seul segment depuis `quality_range` et `modifier_range`.
   - Stat avec valeur de base connue et trouvée → `absolute` ; sinon `percent` (comme le dump).
   - Libellé = `label` du wiki ; unité, transformation et échelle = table fixe reprise du dump.
   - Si le plan n'a ni modificateur ni fiche détaillée → la colonne n'est pas modifiée.
2. **Lieux de minage** remplis par `sync_blueprints` depuis le wiki. Une ligne par (minerai × lieu × méthode),
   `source = 'wiki'`. Si le wiki ne renvoie aucune ligne, la table n'est pas vidée.
3. **Noms FR** posés à la fin de `sync_blueprints` depuis le pack FR installé. Un nom introuvable ne
   modifie pas la valeur existante. Pas de pack installé → étape ignorée.
4. L'appel aux dumps dans `sync_blueprints` (stats et minage) est retiré.

## Architecture
- `wiki_sync/craft_stats.rs` : `build_craft_stats(detail, item) -> Option<Vec<Value>>` (pur).
- `wiki_sync/mining.rs` : `normalise_to_stem`, `apply_stem_alias` (déplacés), `commodity_stem`,
  `mining_rows(commodity) -> Vec<MiningRow>` (purs) et `sync_mining_from_wiki`.
- `wiki_sync/fr_names.rs` : `parse_ini`, `fr_name_for_class` (purs) et `apply_fr_names`.

## Erreurs et cas limites
Wiki hors ligne ou 404 → données existantes conservées, erreur comptée dans le résultat de la synchro.

## Lot B : retrait de l'extraction (maquette `docs/design/maquette-retrait-datamining.html`, validée le 13/11/2026)
- Supprimés : StarBreaker (`src-tauri/resources/starbreaker`), `commands/datamining_extract`, l'import
  depuis les dumps (`blueprint_stats`, `blueprint_names`, `mining`), le dossier codé en dur, la pastille
  Datamining, la modale de consentement, la carte Datamining (Réglages › Jeu), la ligne « Datamining du
  jeu » (Réglages › Données), les étapes `mining` et `enrich` de la première ouverture.
- Conservés : chemin du jeu (`commands/sc_install.rs`, clé AppMeta `datamining.scInstallPath` inchangée),
  détection de patch, pastille de progression de la première ouverture (`OnboardingBadge`).
- `commands/datamining` renommé `commands/starmap_sync` (il ne contient plus que la carte stellaire) ;
  `DataminingContext` renommé `GameContext`.
- Ajout : alerte Accueil « Nouveau patch {{version}} » → « Synchroniser le wiki » (Réglages › Données),
  tant que la version installée est plus récente que celle des données du wiki.
- Notification « Nouveau patch » : le texte renvoie vers la synchro du wiki.

## Vérification
- Tests Rust : `build_craft_stats` (SureStop absolu, segment unique, base absente → percent, gpp inconnu),
  `mining_rows` (méthode, rareté, système, doublons), `commodity_stem`, `fr_name_for_class`.
- `cargo clippy -D warnings`, `cargo test`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run`.
- Essai réel par André : Réglages → Données → synchro Wiki, puis fiche d'un plan (stats) et « Où miner ? ».
