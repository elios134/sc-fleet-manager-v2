# Personnages et cache du jeu (spec)

Validée par André le 15/11/2026 (maquette `docs/design/maquette-personnages-cache.html`, Personnages
variante A + Cache du jeu). Référence : MultitoolV2 (`presets_list_functions.rs`,
`local_characters_functions.rs`, `cache_functions.rs`).

## Objectif
Installer des presets de personnage depuis star-citizen-characters.com et gérer ceux du jeu ; vider le
cache du jeu en sachant ce qui est sans risque.

## Ce qui existe déjà (vérifié le 15/11/2026)
- API publique `GET https://www.star-citizen-characters.com/api/heads?page=N&orderBy=latest|download&search=…`
  → `body.{rows, hasNextPage}` ; ligne : `id, title, createdAt, user.name, previewUrl, dnaUrl (.chf),
  _count.{characterDownloads, characterLikes}` (12 par page). Images sur `images.star-citizen-characters.com`.
- Presets du jeu : `<canal>/user/client/0/CustomCharacters/*.chf` (chez André : John Wick, Lucyna Kushinada).
- Cache : `%LOCALAPPDATA%\Star Citizen\` → `starcitizen_(sc-alpha-4.10.0)_…` (3 135 Mo),
  `starcitizen_(sc-alpha-4.10.2)_…` (3 089 Mo), `crashes` (312 Mo). Version installée :
  `build_manifest.id` `Version` = `4.10.200.58746` → 4.10.2.

## Fonctionnalités
### Personnages (onglet « Personnages » du hub Outils, variante A)
- Catalogue en cartes (vignette, titre, auteur, téléchargements, j'aime), recherche, tri Populaires
  (`download`) / Récents (`latest`), « Afficher plus » (page suivante). Badge « Dans le jeu » et bouton
  « Déjà installé » si un preset local porte le même nom (casse ignorée).
- « Installer dans le jeu » : télécharge le `.chf` (URL https sur images.star-citizen-characters.com
  seulement) et l'écrit dans `CustomCharacters` de chaque canal installé (dossier créé si besoin). Nom de
  fichier = titre nettoyé (`<>:"/\|?*` → `_`).
- Colonne « Dans le jeu » : presets locaux (nom, canal, date), « Copier vers les autres versions »,
  « Supprimer » (confirmation), « Ouvrir le dossier ». « Ouvrir le site ».
### Cache du jeu (onglet « Cache du jeu » du hub Outils)
- Total, barre empilée, légende ; une ligne par dossier : Shaders <version> (ancienne version / version
  installée), Rapports de plantage, autre. Taille en Mo.
- « Libérer N Go sans risque » = anciennes versions + plantages ; « Tout vider » ; « Supprimer » par ligne ;
  confirmation listant ce qui part. Boutons désactivés et message si StarCitizen.exe tourne.
- « Ouvrir le dossier », « Recalculer ».

## Architecture
- Rust `commands/characters.rs` : `characters_catalog`, `characters_local`, `characters_install`,
  `characters_delete`, `characters_copy`, `characters_open_folder` ; purs testés : `sanitize_file_name`,
  `is_allowed_dna_url`, `catalog_row`.
- Rust `commands/game_cache.rs` : `game_cache_info`, `game_cache_delete(names)`, `game_cache_open` ; purs
  testés : `short_version`, `folder_version`, `classify`, `is_plain_name`.
- Front `pages/Characters/`, `pages/GameCache/` ; onglets dans `navHubs.ts` / `pages/Hub` ; CSP img-src +
  `https://images.star-citizen-characters.com`.

## Sécurité
Téléchargement limité au domaine du site et à `.chf`. Suppression de preset limitée à un `.chf` d'un dossier
`CustomCharacters` d'une installation ; suppression de cache limitée aux enfants directs de
`%LOCALAPPDATA%\Star Citizen` désignés par nom (pas de `..` ni de séparateur). Rien n'est envoyé au site.

## Erreurs et cas limites
Site injoignable : message + « Réessayer ». Jeu introuvable : installation désactivée, message vers
Réglages › Jeu. Dossier de cache absent : « Aucun cache ». Jeu lancé : suppression refusée côté Rust aussi.

## Vérification
Tests Rust des fonctions pures ; tsc, lint, vitest, clippy, cargo test ; essai réel par André.
