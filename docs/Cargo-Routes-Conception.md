# SC Fleet Manager — Module « Cargo & Routes »

> Document de conception fonctionnelle · V2 (Tauri/React/Rust)
> Source de données principale : **SC Trade Tools API** — `https://sc-trade.tools`
> Statut : proposition · à valider avant tout développement

---

## 1. L'idée en une phrase

Transformer SC Fleet Manager d'un **gestionnaire de collection** en un **outil qu'on ouvre à chaque session de jeu**, en ajoutant deux écrans complémentaires : un **planificateur de routes commerciales** qui dit où acheter, où vendre et combien on gagne, et une **grille de soute visuelle** qui montre comment le chargement occupe les conteneurs réels du vaisseau.

Ces deux écrans réutilisent ce que l'app possède déjà (la flotte du joueur, les vaisseaux et leur capacité SCU) et s'appuient sur une API externe pour les prix de marché en temps réel — donnée que l'app n'a pas et ne peut pas dataminer.

---

## 2. Pourquoi cette fonctionnalité

Aujourd'hui l'app répond à « qu'est-ce que je possède ? ». Elle ne répond pas à « qu'est-ce que je fais de ma session de jeu, là, maintenant ? ». Les outils concurrents (SC Trade Tools, UEX, SC DataHub) ont fait du commerce et du hauling leur cœur, parce que c'est l'activité quotidienne d'un grand nombre de joueurs.

L'intérêt pour SC Fleet Manager est double :

- **Rétention** : un joueur ouvre l'app au début de chaque session pour planifier son run, pas seulement quand il achète un vaisseau.
- **Réutilisation de l'existant** : la liste des vaisseaux du joueur et leur capacité cargo sont déjà en base. Le module se greffe dessus sans nouveau chantier de datamining.

---

## 3. Les deux écrans

### 3.1 Planificateur de route

Le joueur choisit un vaisseau de sa flotte, indique un budget d'investissement en aUEC, et l'app propose les **routes commerciales les plus rentables** : où acheter quelle marchandise, où la revendre, le profit attendu, le temps estimé. Une variante « itinéraire » permet de fixer un point de départ et une destination et de remplir les arrêts intermédiaires les plus profitables sur le chemin.

Ce que voit le joueur :

- un récapitulatif en haut (vaisseau, capacité SCU, profit estimé) ;
- un formulaire de saisie (marchandise, lieu de prise, lieu de livraison, quantité) ;
- un itinéraire optimisé présenté en étapes numérotées, avec le SCU cumulé à bord et le gain final ;
- un bouton d'export de la feuille de route.

### 3.2 Grille de soute

Une représentation visuelle du chargement, fidèle à la composition réelle des conteneurs du vaisseau (telle que décrite par le Cargo Grid Reference Guide). Chaque vaisseau a sa propre composition de slots — par exemple le C2 Hercules = 20 conteneurs de 32 SCU + 28 de 2 SCU. La grille montre quels conteneurs sont occupés par quelle marchandise et lesquels restent libres.

Ce que voit le joueur :

- des stat cards (soute totale, utilisé, libre, nombre de conteneurs) ;
- un sélecteur de vaisseau ;
- une vue isométrique pseudo-3D des conteneurs empilés, colorés par marchandise ;
- un manifeste latéral (liste des marchandises chargées + barre de remplissage) ;
- un bouton « auto-remplir » (best-fit du manifeste dans les conteneurs disponibles).

> Note de fidélité : la **composition** des conteneurs (nombre et tailles) est reproduite exactement. Le **placement spatial** précis dessiné dans le guide n'est pas dérivable automatiquement et reste une approximation, sauf encodage manuel vaisseau par vaisseau.

---

## 4. La source de données : SC Trade Tools API

L'API `sc-trade.tools` est le moteur de la fonctionnalité. Elle expose à la fois les **données de référence** (marchandises, boutiques, lieux, vaisseaux) et des **outils de calcul prêts à l'emploi** (routes rentables, itinéraires, meilleurs acheteurs). C'est un point clé : on n'a pas à réécrire l'algorithme d'optimisation de route — l'API le fait.

### 4.1 Endpoints de données de référence (lecture, à mettre en cache)

| Endpoint | Rôle dans le module |
|---|---|
| `GET /api/commodity/items` | Liste des marchandises échangeables (agricium, laranite, gold…). Alimente le sélecteur de marchandise. |
| `GET /api/commodity/shops` | Boutiques qui achètent/vendent. Alimente les lieux de prise et de livraison. |
| `GET /api/locations` | Lieux connus (planètes, lunes, stations, avant-postes). |
| `GET /api/ships` | Vaisseaux avec leur capacité cargo (`maxBoxSizeInScu`). Sert à valider la taille de conteneur supportée. |
| `GET /api/factions`, `/api/security-levels`, `/api/location-types` | Filtres avancés optionnels. |

### 4.2 Endpoints outils (calcul, nécessitent un token)

| Endpoint | Rôle dans le module |
|---|---|
| `POST /api/tools/trades` | **Routes commerciales rentables** classées par profit ou profit/temps, pour un vaisseau et un budget donnés. C'est le cœur du Planificateur de route. |
| `POST /api/tools/itinerary` | **Itinéraire** : séquence ordonnée d'arrêts entre une origine et une destination, optimisée pour le profit total. |
| `POST /api/tools/buyers` | **Meilleurs acheteurs** pour une marchandise précise, classés par prix, avec estimation du profit total selon la quantité. |
| `POST /api/tools/circuits/{tradeId}` | **Route circulaire** multi-arrêts qui revient au point de départ. |

### 4.3 Paramètres clés de l'appel `trades` / `itinerary`

Les paramètres importants (lus depuis la spec OpenAPI) :

- `ship` — nom du vaisseau (issu de `GET /api/ships`). Dans notre cas, le vaisseau sélectionné dans la flotte du joueur.
- `investment` — budget en aUEC (1 à 100 000 000).
- `profitType` — stratégie : `time` pour maximiser le profit par seconde (efficacité globale), `pure` pour le profit brut sans tenir compte du temps de trajet.
- `maxStops` — nombre maximal d'arrêts (1 à 5).
- `supportedBoxSizeInScu` — taille de conteneur max chargeable par le vaisseau (1, 2, 4… jusqu'à 32). À mapper depuis la capacité réelle du vaisseau.
- `origin` / `destination` — boutiques de départ/arrivée (pour l'itinéraire).
- `allowableDetour` — pour l'itinéraire, tolérance de détour en % du trajet direct (0 = aucun détour, 100 = arrêts intermédiaires libres).

### 4.4 Données renvoyées (résultat d'une route)

Chaque route renvoie une origine et une destination (objet transaction) plus des métriques :

- `profit` — gain total en aUEC ;
- `profitPerMinute` — gain par minute (pour le classement par efficacité) ;
- `timeInSeconds` — durée estimée ;
- pour chaque transaction : `location`, `shop`, `itemName`, `price`, `quantityInScu`, `maxQuantityInScu`, `boxSizesInScu`, `action` (acheter/vendre).

Ces champs alimentent directement la timeline d'itinéraire et les stat cards.

---

## 5. Authentification et conditions d'accès

Les endpoints `/tools/*` exigent un **token** passé dans l'en-tête `token` de la requête. Les endpoints de données de référence (`/commodity/items`, `/ships`, etc.) sont en accès libre.

La documentation de l'API mentionne l'acquisition d'une **licence API** ou un soutien via Patreon pour l'usage des outils. Point à clarifier côté projet avant intégration : obtenir le token et vérifier les conditions d'usage (à traiter en amont du développement).

L'API renvoie des codes explicites à gérer : `403` (token invalide/absent), `429` (trop de requêtes), `400` (paramètres invalides).

---

## 6. Architecture proposée (haut niveau)

Le découpage suit le même pattern que les syncs existantes de l'app (hangar, SC Wiki) : on récupère les données de référence en cache local, et on appelle les outils à la demande.

### 6.1 Couche données

- **Cache local** des données de référence (marchandises, boutiques, lieux, vaisseaux) en base SQLite, rafraîchi au démarrage + bouton manuel. Évite de spammer l'API et de dépendre du réseau pour remplir les sélecteurs.
- **Appels temps réel** aux endpoints `/tools/*` au moment où le joueur lance un calcul de route. Pas de cache (les prix bougent).
- **Layouts de soute** stockés en dur (table de composition par vaisseau, lue du Cargo Grid Reference Guide), indépendants de l'API.

### 6.2 Couche logique

- Mapping entre les vaisseaux de la flotte du joueur et les noms de vaisseaux attendus par l'API (`GET /api/ships`).
- Déduction du `supportedBoxSizeInScu` à partir de la capacité du vaisseau.
- Pour la grille : algorithme de remplissage best-fit qui place le manifeste dans les conteneurs disponibles.

### 6.3 Couche UI

- Deux onglets (Planificateur de route, Grille de soute), intégrés dans la navigation existante.
- Réutilisation des composants visuels de l'app (stat cards, chips, glass panels, accent ambre).

---

## 7. Découpage en phases (livrables indépendants)

| Phase | Contenu | Dépendance |
|---|---|---|
| **A** | Cache des données de référence (marchandises, boutiques, lieux, vaisseaux) + sync + table SQLite. Aucun UI. | Token API obtenu |
| **B** | Grille de soute (vue iso, layouts en dur, manifeste manuel, best-fit). Indépendante de l'API tools. | Composition slots (PDF) |
| **C** | Planificateur de route (formulaire + appel `trades`/`itinerary` + rendu timeline). | Phase A |
| **D** | Affinages : route circulaire, meilleurs acheteurs, export feuille de route, filtres avancés. | Phase C |

Ordre conseillé : **A**, puis **B** et **C** en parallèle, **D** en dernier.

---

## 8. Points ouverts à trancher

1. **Token / licence API** : obtenir l'accès aux endpoints `/tools/*` et valider les conditions d'usage. Bloquant pour les phases C et D.
2. **Périmètre de la grille** : composition fidèle (auto) suffisante, ou placement spatial exact à encoder pour certains vaisseaux ?
3. **Mapping des noms de vaisseaux** entre la flotte du joueur et le référentiel de l'API — à vérifier sur quelques cas (variantes, vaisseaux récents).
4. **Fréquence de rafraîchissement** du cache de données de référence (au démarrage seul, ou aussi périodique ?).

---

*Données API vérifiées sur la spécification OpenAPI de SC Trade Tools (`/v3/api-docs`).*
