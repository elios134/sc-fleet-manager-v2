# Audit UX/UI — Overlay en jeu

Date : 14 septembre 2026  
Périmètre : fenêtre Tauri `overlay`, son HUD de navigation et de timers, ainsi que sa configuration dans les réglages.

## Résumé

L'overlay repose sur une base technique solide : il est transparent, toujours au-dessus du jeu, ne vole pas le focus, peut être basculé avec `F6`, conserve sa position et propose un clic-traversant. Il sait aussi afficher une route active depuis Cargo & Routes / le panier Catalogue, déduire l'étape courante à partir du GameLog, et suivre le Hangar exécutif.

L'amélioration principale n'est donc pas fonctionnelle : elle concerne la lecture pendant une session de jeu. Le rendu actuel garde les codes d'une petite fenêtre applicative, alors que le besoin est celui d'un instrument de navigation immédiatement lisible.

## État actuel

### Capacités présentes

- Route multi-étapes, localisation courante, profit, volume SCU, durée, sauts et alerte de ravitaillement.
- Timers du Hangar exécutif et timers indépendants de terminaux.
- Opacité, position, taille, verrouillage, clic-traversant et mode compact persistés.
- Panneaux route/timers configurables et onglet par défaut.
- Raccourci global `F6`, compatible avec le jeu au premier plan sous Windows.

### Surface actuelle

- Fenêtre initiale : `360 × 480 px`.
- Deux panneaux exclusifs via onglets (`Route` et `Timers`) lorsque les deux sont activés.
- En-tête : verrouillage, clic-traversant, compact, opacité et fermeture.
- Mode compact : une seule étape courante, avec trajet, profit et éventuelle alerte carburant.

## Constats

### 1. L'information utile n'est pas assez dominante

La destination et l'action suivante sont au même niveau que le reste du contenu. En jeu, la réponse attendue doit être visible instantanément : **où aller maintenant, avec quelle cargaison, et quel risque exige une réaction**.

### 2. Les onglets masquent des informations potentiellement urgentes

Une route et un compte à rebours de hangar peuvent être utiles au même moment. L'utilisateur doit aujourd'hui changer d'onglet pour les consulter, ce qui est peu adapté à une lecture rapide au-dessus du jeu.

### 3. Les commandes d'en-tête sont trop petites et trop denses

Les boutons d'icône font `20 × 20 px` et ne donnent pas de libellé visible. Leur fonction est difficile à identifier en plein jeu, particulièrement avec une opacité abaissée.

### 4. Le clic-traversant mérite un mode explicite

Le clic-traversant est essentiel pour ne pas gêner le jeu, mais une fois activé il rend l'overlay non interactif. Il faut rendre sa bascule et son état plus explicites, avec un moyen de retour clair via raccourci ou panneau de réglages.

### 5. Le mode compact doit devenir le mode d'usage prioritaire

Le mode compact va dans la bonne direction, mais ne transporte pas encore toutes les informations de décision : progression, ETA, volume ou marchandise. Il devrait être conçu pour l'usage continu ; la vue développée servirait à préparer ou vérifier.

### 6. La progression présente un détail de compréhension

La première étape est affichée avec une progression `0/n`, car l'index interne est zéro-based. Pour une personne, l'étape active doit se lire `1/n` dès le départ.

### 7. La couleur d'accent ne suffit pas à exprimer les statuts

L'accent peut varier selon le thème constructeur. Les états fonctionnels doivent conserver des couleurs dédiées et constantes : navigation, confirmé, attention, danger et inactif.

## Direction recommandée : Nav Rail

Une direction de HUD d'instrumentation spatiale originale, sobre et compacte. Elle ne cherche pas à reproduire l'interface de Star Citizen : elle privilégie une identité propre à SC Fleet Manager et une lecture périphérique.

### Principes visuels

- Une destination principale très dominante.
- Une ligne de progression unique qui rend la prochaine étape évidente.
- Une palette sémantique dédiée aux statuts, indépendante de la couleur d'accent choisie.
- Une typographie courante lisible, avec une police mono réservée aux données (ETA, compteur, profit).
- Une transparence plus légère et moins de surfaces opaques pour ne pas cacher le jeu.
- Des animations limitées aux changements de statut et alertes ; aucune animation décorative permanente.

### Composition proposée

```text
┌ SCFM  •  NAVIGATION                         2 / 4 ┐
│                                                     │
│  PROCHAINE ÉTAPE                                    │
│  HDMS-STANHOPE  ───────────────▶  AREA18            │
│  QUANTANIUM · 576 SCU        ETA 14 MIN · 2 SAUTS   │
│                                                     │
│  ● Vous êtes ici                    +1 420 000 aUEC │
│  ──────────────◉──────────────────────────────────  │
│  RAVITAILLEMENT REQUIS AVANT ÉTAPE 3                 │
└───────────────────────────────  HANGAR  08:42  ────┘
```

### Densités d'affichage

| Mode | Usage | Contenu |
| --- | --- | --- |
| Passif | Pendant le vol ou le déplacement | Prochaine destination, progression, ETA, une alerte éventuelle, timer critique. |
| Étendu | Préparation / vérification | Itinéraire complet, données de cargo, profit, timers et réglages légers. |
| Réglage | Ajustement ponctuel | Position, verrouillage, opacité, clic-traversant et panneaux actifs. |

## Axes de mise en œuvre

### Priorité 1 — Lisibilité et interaction

1. Remplacer l'en-tête actuel par une barre courte qui indique le contexte actif (`Navigation` ou `Timers`).
2. Faire de la prochaine étape le bloc principal, avec départ, destination, cargaison et ETA.
3. Afficher les timers critiques dans une zone secondaire persistante plutôt que dans un onglet séparé.
4. Augmenter les zones cliquables en mode réglage et rendre chaque état visible par un libellé ou une infobulle persistante.
5. Corriger l'affichage humain de la progression : `activeIndex + 1` sur le compteur.

### Priorité 2 — Mode compact et alertes

1. Étendre la barre compacte avec progression, ETA, cargaison/SCU et état carburant.
2. Créer des seuils d'alerte pour les timers (information, attention, urgent).
3. Ne faire apparaître une alerte que lorsqu'elle requiert une action ; les états normaux restent discrets.
4. Prévoir un comportement de repli : la route reste consultable, même si les données du GameLog sont absentes.

### Priorité 3 — Système visuel

1. Définir des tokens d'overlay : surface, bordure, texte secondaire, navigation, succès, attention, danger et inactif.
2. Réserver la couleur d'accent au repérage de navigation et aux contrôles ; ne pas lui confier les statuts critiques.
3. Réduire les bordures décoratives et augmenter le contraste de l'information active.
4. Conserver les thèmes constructeur existants comme personnalisation, sans modifier la signification des alertes.

## Fichiers concernés par une future refonte

- `src/OverlayApp.tsx` — structure, états, route, timers et mode compact.
- `src/pages/Settings/components/OverlayCard.tsx` — réglages, profils d'affichage et libellés d'état.
- `src/styles/theme.css` — éventuels tokens d'overlay partagés.
- `src/i18n/locales/fr.json` et `src/i18n/locales/en.json` — libellés additionnels.

## Critères de réussite

- En moins d'une seconde, la destination suivante et l'action urgente éventuelle sont compréhensibles.
- Les informations de route et un timer critique sont visibles sans bascule d'onglet.
- L'overlay reste peu intrusif sur le jeu en mode passif.
- Les réglages restent accessibles et le clic-traversant n'engendre pas de situation ambiguë.
- La palette reste lisible quel que soit le thème constructeur choisi.

