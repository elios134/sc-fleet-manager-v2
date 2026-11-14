# Réputation et Reprendre ma partie (spec)

Validée par André le 15/11/2026 (maquette `docs/design/maquette-reprendre-reputation.html`, Réputation
variante A + Reprendre ma partie).

## Objectif
Suivre sa réputation par faction sans rien saisir, et retrouver d'un coup d'œil où on en était avant
de relancer le jeu.

## Ce qui existe déjà (vérifié le 14-15/11/2026)
- Game.log : à l'acceptation, `<CLocalMissionPhaseMarker::CreateMarker> … missionId [X], … contract [C]`
  (plusieurs lignes par mission) ; titre localisé dans `Added notification "Nouvelle mission : <titre>: "
  … MissionId: [X], ObjectiveId: []` ; fin `<EndMission> MissionId[X] … CompletionType[Complete]` (déjà
  parsé, kind `mission`) ; plans reçus `Added notification "Plan de fabrication reçu: <nom>: "`.
  Aucun point de réputation ni rang dans le log.
- Wiki (table `Mission`) : `debugName` = nom du contrat, `factionName`, `reputationGained` (JSON
  `[{amount, faction, scope}]`), `minStandingName`, `maxStandingName`, `timeMins`. Réputation connue
  pour 1 757 missions sur 2 437. Échelles de rangs : tables `Scope` / `Rank` (minReputation, rangeXP).
- Le parseur de plans du crafting (`log_resync`) ne reconnaît pas le libellé FR actuel
  « Plan de fabrication reçu » (seulement « Schémas reçus ») : corrigé ici.

## Fonctionnalités
### Lecture du Game.log
- Nouveaux événements : `mission_contract` {missionId, contract}, `mission_title` {missionId, title}
  (balises `<EM4>` et suffixe « N exp. » retirés), `blueprint` {name}. Un seul `mission_contract` et un
  seul `mission_title` par mission.
### Réputation (onglet « Réputation » du hub Missions, variante A)
- Une ligne de suivi par (faction, échelle) : chaque mission terminée dont le contrat est connu du wiki
  ajoute ses `reputationGained` (échelles sans table de rangs et « Affinity » ignorées).
- Rang : déclaré (si corrigé par le joueur) > déduit (plus haut `minStandingName` des missions acceptées
  chez la faction, trouvé dans l'échelle) > inconnu (départ à 0).
  Réputation actuelle = min du rang de départ + réputation dans ce rang (déclarée, sinon 0) + gains
  postérieurs à la déclaration (tous les gains pour un rang déduit ou inconnu). Affichée « au moins »
  si le rang n'est pas déclaré.
- Fiche : emblème (monogramme), rang, anneau % vers le rang suivant, échelle des rangs (objectif =
  rang suivant), 4 chiffres (gagné depuis le suivi, missions terminées, réputation avant le rang
  suivant, missions restantes à la réputation moyenne des missions conseillées), bandeau « rang déduit »
  + bouton « Corriger mon rang » (fenêtre : rang + réputation dans ce rang ; « revenir au rang déduit »).
- Onglets : « Missions conseillées » (missions de la faction pour cette échelle, accessibles au rang
  actuel, triées par réputation par heure, 8 max) et « Journal » (date, titre, +réputation, plans reçus
  dans les 60 s suivant la fin).
- Liste de gauche : factions suivies, plus récente d'abord.
- Stockage : table `UserFactionReputation` (compte, faction, échelle, rang, réputation dans le rang,
  date). Rien d'autre n'est stocké : tout est recalculé depuis `GameLogEvent` et `Mission`.
### Reprendre ma partie (onglet du hub Inventaire)
- Bandeau « Où j'en étais » : dernier lieu connu, système, date et durée de la dernière session ;
  boutons « Voir sur la carte » et « + Itinéraire » (comme l'Inventaire).
- « Dernière session » : frise des événements de la dernière session (connexion, vaisseau, missions
  acceptées / terminées avec réputation et plans, morts, sauts quantiques regroupés).
- « Ce que je visais » : progression de la faction la plus récemment active vers son rang suivant.
- « Sur moi » (5 premiers objets + total) et « Laissé ailleurs » (lieux avec objets), depuis l'Inventaire.

## Architecture
- Rust : `gamelog/parse.rs` (3 parseurs), `gamelog/mod.rs` (dédoublonnage), `commands/reputation/`
  (`domaine.rs` pur + tests, `mod.rs` commandes `get_reputation_overview`, `set_faction_rank`,
  `clear_faction_rank`, `get_last_session`). Migration `0041_faction_reputation.sql`.
- Front : `pages/Reputation/` (index, components FactionList, FactionHero, RankLadder, RankRing,
  AdviceTable, JournalTable, CorrectRankModal, lib pure + tests) ; `pages/Resume/` ; onglets ajoutés dans
  `navHubs.ts` et `pages/Hub`.

## Erreurs et cas limites
Aucune mission reconnue : état vide qui explique de terminer une mission avec le Game.log activé.
Contrat absent du wiki : mission ignorée pour la réputation, reste dans la frise. Missions passées
sans contrat enregistré : non comptées (rejouer le Game.log les rattrape si les fichiers existent).

## Hors périmètre
Rangs exacts du jeu (non écrits dans le log) ; pertes de réputation des missions échouées (inconnues).

## Vérification
Tests Rust (parseurs, rang déduit, réputation actuelle, conseillées, rattachement des plans) et TS (lib
d'affichage). tsc, lint, vitest, clippy, cargo test. Essai réel : rejouer le Game.log, onglet Réputation
→ InterSec +300, Veteran Contractor au moins.
