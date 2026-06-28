# Carte stellaire — Sous-projet A : bascule de la source vers l'API RSI Starmap

**Date** : 2026-06-28
**Statut** : design validé (en attente de relecture spec)
**Contexte parent** : refonte complète de la carte stellaire pour un rendu proche de la carte in-game. Deux sous-projets décidés : **A** (données, ce document) puis **B** (rendu 3D `Starmap3D.tsx`). Référence d'inspiration : Stelliverse (GitLab `drrakendu78`, AGPL-3.0) — on ne réutilise **aucun** asset ni code, on lit l'API RSI publique en clean-room.

---

## 1. Problème & objectif

Aujourd'hui la table `StarmapBody` est alimentée **100 % depuis le SC Wiki** (`sync_starmap_from_wiki`, cf. commentaire `datamining_extract.rs:558`). Le Wiki ne fournit que des coordonnées cartésiennes `posX/Y/Z` ; il manque la longitude orbitale exacte, les jump points, les ceintures d'astéroïdes, les sous-types et l'« appearance » des corps — tout ce qui rapproche le rendu de la carte officielle.

L'**API RSI Starmap** (`POST https://robertsspaceindustries.com/api/starmap/star-systems/{CODE}`) est vivante (`time_modified` 2025-09) et renvoie exactement cette donnée riche, dans le même format que celui figé par Stelliverse.

**Objectif du sous-projet A** : faire de l'API RSI la source de vérité de `StarmapBody`, en restant **rétro-compatible avec la carte 2D existante** (qui lit `posX/Y/Z`) et en stockant les champs natifs nécessaires au futur renderer 3D.

**Hors périmètre A** : tout changement du moteur de rendu (2D `StarmapCanvas` ou 3D `Starmap3D`), les POI de surface (VerseTime), l'ajout de systèmes au-delà des 3 actuels.

---

## 2. Source de vérité & rétro-compatibilité

- **RSI devient la source de vérité** de `StarmapBody` (`source = 'rsi'`).
- Le sync **Wiki est conservé en repli hors-ligne** : si le sync RSI échoue **et** que `StarmapBody` est vide, on déclenche `sync_starmap_from_wiki`. Le bouton Wiki manuel et l'étape d'onboarding restent en place.
- **Dérivation `posX/Y/Z`** depuis `distance` + `longitude` + `latitude` → la carte 2D (`buildSystemLayout`, qui calcule l'angle via `atan2(posY, posX)` et le rayon via la norme) **continue de fonctionner sans modification**.

---

## 3. Format de l'API RSI (référence de mapping)

`resultset[0]` = le système ; `resultset[0].celestial_objects[]` = les corps. Champs utiles d'un objet :

| Champ RSI | Type | Remarque |
|---|---|---|
| `id` | int | identifiant objet |
| `parent_id` | int\|null | hiérarchie (étoile/planète) |
| `type` | string | `STAR` `PLANET` `SATELLITE` `JUMPPOINT` `ASTEROID_BELT` `MANMADE` |
| `subtype` | obj | `{ name: "Super-Earth", ... }` |
| `name` | string\|null | nom affiché (peut être null pour JP) |
| `designation` | string\|null | « Stanton IV » → chiffre romain |
| `code` | string | `STANTON.PLANETS.STANTONIVMICROTECH` |
| `distance` | number | distance orbitale |
| `longitude` | number | **longitude orbitale (°) — angle exact** |
| `latitude` | number | latitude orbitale (°) |
| `size` | number | taille (km) |
| `habitable` | bool | |
| `appearance` | string | `PLANET_GREEN` `PLANET_GAS`… (pilote la texture en B) |
| `affiliation` | string\|array | code / `[{ color: "#48bbd4" }]` selon le niveau |

Le système lui-même porte `position_x/y/z` (galactique) — non utilisé en A (placement intra-système uniquement).

---

## 4. Schéma — migration `0031_starmap_rsi.sql`

`StarmapBody` (défini en `0008_settings.sql`, étendu en `0021_starmap_wiki.sql`) reçoit de nouvelles colonnes, **toutes nullable**, donc rétro-compatibles avec les lignes existantes :

```sql
ALTER TABLE StarmapBody ADD COLUMN distance  REAL;
ALTER TABLE StarmapBody ADD COLUMN longitude REAL;
ALTER TABLE StarmapBody ADD COLUMN latitude  REAL;
ALTER TABLE StarmapBody ADD COLUMN subtype   TEXT;
ALTER TABLE StarmapBody ADD COLUMN appearance TEXT;
ALTER TABLE StarmapBody ADD COLUMN habitable INTEGER;
ALTER TABLE StarmapBody ADD COLUMN affColor  TEXT;
```

`posX/Y/Z` (existantes) restent et sont **recalculées** à chaque sync RSI. `source`, `lastSyncedAt`, `parentRef`, `recordName` réutilisés tels quels.

---

## 5. Mapping RSI → StarmapBody

Fonction **pure et testable** `map_rsi_system(code: &str, json: &Value) -> Vec<StarmapRsiRow>` (aucun réseau, aucune DB) :

**`navIcon`** (`type` RSI → valeur) :
| `type` | `navIcon` |
|---|---|
| `STAR` | `Star` |
| `PLANET` | `Planet` |
| `SATELLITE` | `Moon` |
| `MANMADE` | `Station` |
| `JUMPPOINT` | `Jumppoint` *(nouveau)* |
| `ASTEROID_BELT` | `AsteroidBelt` *(nouveau)* |

Les `navIcon` nouveaux (`Jumppoint`, `AsteroidBelt`) sont **inconnus du moteur 2D** : `buildSystemLayout` les filtre par liste blanche, donc ils sont **silencieusement ignorés en 2D** (aucun crash) jusqu'à ce que B les gère.

**`id`** : `format!("rsi-{}", obj.id)` (déterministe, clé primaire).
**`wikiUuid`** : `format!("rsi-{}", obj.id)` — **clé de jointure parent↔enfant**. Le moteur 2D calcule `bodyKey = (wikiUuid ?? recordName.split('.').pop()).toLowerCase()` ; en peuplant `wikiUuid`, le `bodyKey` d'un parent vaut `rsi-{id}`.
**`parentRef`** : `obj.parent_id.map(|p| format!("rsi-{p}"))` → vaut le `wikiUuid` (= `bodyKey`) du parent, donc `parentKey(enfant) == bodyKey(parent)` dans le moteur 2D **sans le modifier**. `"rsi-{id}"` est déjà en minuscules (insensible au `toLowerCase()`).
**`recordName`** (stem, doit rester UNIQUE ; pilote couleurs/images de la 2D — on garde la convention du sync Wiki) :
- `Star` → `"{sys}star"`
- `Planet` → `"{sys}{n}"` avec `n` = chiffre romain de `designation` (`roman_to_int`, déjà existant)
- autres → `code` normalisé, repli `rsi-{id}` ; en cas de collision UNIQUE → `rsi-{id}`.

**`posX/Y/Z`** dérivés :
- planète/objet de niveau étoile : `posX = distance·cos(lon)`, `posY = distance·sin(lon)`, `posZ = distance·sin(lat)` (lat≈0 pour les planètes).
- lune/station enfant : position **absolue** = position du parent + position locale dérivée de son propre `distance`/`longitude` (le parent est résolu via `parent_id` dans la même passe).

**Autres champs** : `size`, `subtype = subtype.name`, `appearance`, `habitable` (0/1), `affColor` (couleur d'affiliation si présente), `description` (RSI `description`), `orbitOrder` = chiffre romain (planètes), `showOrbitLine` = `true` pour Planet/Moon/Station.

---

## 6. Commande de sync & écriture

`sync_starmap_from_rsi_core(app: &AppHandle) -> Result<StarmapSyncResult, String>` :
1. Pour chaque `code` ∈ `["STANTON","PYRO","NYX"]` : `reqwest` POST (UA navigateur `Mozilla/5.0`, `Content-Type: application/json`, corps `"{}"`, timeout ~25 s). Parse `resultset[0].celestial_objects`.
2. Concatène les `map_rsi_system(code, json)` de tous les systèmes.
3. **Garde-fou** : si **0 ligne au total** (tous les appels ont échoué / vides) → **ne pas toucher** `StarmapBody`, renvoyer `Err` (table conservée), comme le fait déjà le sync Wiki.
4. Sinon : en **transaction**, `DELETE FROM StarmapBody` puis `INSERT` toutes les lignes (clear-then-recreate idempotent), `source='rsi'`, `lastSyncedAt = datetime('now')`.
5. Renvoie `StarmapSyncResult` (réutilise la struct existante : compteurs par système / par type / erreurs).

Commande Tauri exposée `sync_starmap_from_rsi(app)` (déclaration dans `main.rs` à côté de `sync_starmap_from_wiki`).

---

## 7. Auto-sync périodique & repli

`spawn_starmap_sync(app: AppHandle)` ajoutée dans le `setup()` de `main.rs` (même pattern que `spawn_monitor` / `spawn_gamelog_watcher` / `spawn_overlay_hotkey`) :
- **Au lancement** (tâche `tokio::spawn`) : lire `MAX(lastSyncedAt)` des lignes `source='rsi'`. Si **aucune** ligne RSI **ou** `lastSyncedAt` > **7 jours** → lancer `sync_starmap_from_rsi_core`.
- **Repli** : si ce sync RSI renvoie `Err` **et** que `StarmapBody` est vide → lancer `sync_starmap_from_wiki_core`.
- **Re-vérification** toutes les **24 h** tant que l'app tourne (`tokio::time::interval`), même condition de fraîcheur.
- Best-effort : toute erreur est journalisée (`eprintln!`), jamais fatale au démarrage.

---

## 8. UI Réglages

Dans `SettingsPage.tsx`, à côté du bouton « sync starmap Wiki » :
- bouton **« Synchroniser la carte (RSI) »** → `invoke("sync_starmap_from_rsi")`, affiche le `StarmapSyncResult` (mêmes compteurs que le Wiki).
- affichage de la **date du dernier sync RSI**.

Pas d'autre changement front (le moteur 2D n'est pas touché).

---

## 9. Tests

Tests Rust unitaires (pas de réseau, comme les tests du parser `gamelog.rs`) sur `map_rsi_system` avec une **fixture JSON figée** (extrait réel d'un système, embarqué via `include_str!` ou littéral) :
- mapping `type` → `navIcon` pour les 6 types ;
- hiérarchie : `parentRef` d'une lune == `wikiUuid` de sa planète (clé de jointure du moteur 2D) ;
- dérivation `posX/Y/Z` cohérente (planète à `lon=0` → `posY≈0`, `posX≈distance`) ;
- position absolue d'une lune = parent + local ;
- `recordName` : `stantonstar`, `stanton4` (microTech = Stanton IV), unicité en cas de collision ;
- **garde-fou** : `map_rsi_system` sur un JSON vide → `Vec` vide → la commande ne wipe pas la table.

---

## 10. Périmètre & décisions par défaut

- **3 systèmes** : Stanton, Pyro, Nyx (comme aujourd'hui), boucle facilement extensible.
- **Wiki conservé** en repli hors-ligne (pas de suppression de code).
- **Champs polaires natifs stockés** + `posX/Y/Z` dérivés (double usage 3D futur / 2D actuel).
- **Aucune** modification des moteurs de rendu en A. La 2D ignore proprement les nouveaux `navIcon`.

---

## 11. Risques

- **API non-officielle** : peut changer de format ou tomber. Mitigé par : garde-fou 0-objet (table conservée), repli Wiki, sync best-effort non bloquant.
- **`recordName` / couleurs 2D** : la convention de stem doit rester identique au sync Wiki pour ne pas casser les images/couleurs de la 2D ; couvert par les tests de `recordName`.
- **Cohérence `parentRef`** : *résolu* — le moteur 2D joint via `bodyKey = wikiUuid ?? stem(recordName)` et `parentKey = parentRef`. On peuple `wikiUuid = rsi-{id}` et `parentRef = rsi-{parent_id}` pour que les clés coïncident sans toucher au moteur 2D (cf. §5). Couvert par un test de hiérarchie.
- **Tests de hiérarchie** : doivent vérifier que `parentRef(lune) == wikiUuid(planète)`, pas seulement `== id(planète)`.
