# Qualité et sécurité (spec)

Demandé par André le 26/10/2026 (« fais les points 1 et 2 puis publie »), intégré à la 3.4.0.
Aucun changement visuel voulu : les couleurs passent par des jetons de même valeur.

## Objectif
Rendre le dépôt irréprochable pour un recruteur et réduire la surface d'attaque, sans changer le
comportement de l'appli. Réussi quand : lint à 0 erreur et 0 avertissement, CI verte à chaque
envoi, CSP limitée aux domaines réellement utilisés, `npm audit` sans faille corrigeable.

## Ce qui existe déjà (vérifié le 26/10)
- ESLint 10 n'est pas une dépendance du projet et aucun `eslint.config.*` n'existe : le lint ne
  tourne pas.
- Une seule action GitHub : `release.yml` (sur tag). Aucune vérification à chaque envoi.
- 88 fichiers contiennent des couleurs hexadécimales ; `theme.css` n'a pas de jetons pour les
  couleurs d'état (succès, erreur, info, avertissement).
- CSP : `connect-src … https:` et `img-src … https:` acceptent n'importe quel site.
- `npm audit` : 6 failles (outils de dev pour la plupart ; `fflate` et `nanoid` en dépendances).
- 5 fichiers Rust > 700 lignes (`cargo_routes/mod`, `loadout`, `rsi_scrape`, `uex`,
  `cargo_routes/engine`).
- Revue v3.4 : « 0 $ » affiché dans la flotte ; bilan du Minage à 0 au lieu de « — » sans brut.

## Fonctionnalités
1. **Lint** : ESLint + typescript-eslint + react-hooks en dépendances de dev, script `npm run
   lint`, 0 erreur et 0 avertissement.
2. **CI** : `.github/workflows/ci.yml` à chaque envoi et pull request : `tsc`, lint, vitest,
   `cargo clippy -D warnings`, `cargo test`. Badge dans le README.
3. **Couleurs** : jetons d'état dans `theme.css` (mêmes valeurs qu'aujourd'hui) et usage de ces
   jetons dans les composants. Les registres de données (couleurs de systèmes, matériaux 3D, cartes
   canvas/WebGL) restent des données.
4. **Découpage** des fichiers Rust > 700 lignes en sous-modules (déplacement pur).
5. **Défauts de la revue** : valeur ≤ 0 → « — » dans la flotte ; bilan du Minage « — » sans brut.
6. **Sécurité** : CSP limitée aux domaines appelés par le front ; `npm audit fix` (sans montée de
   version majeure) ; relecture des permissions Tauri.

## Hors périmètre
- Refonte de pages (v3.6) ; montées de version majeures des dépendances (`--force`).
- `cargo audit` : l'outil n'est pas installé ; à ajouter à la CI plus tard.

## Vérification
`npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `cargo clippy`, `cargo test` verts ; essai
réel par André (aucune différence visible attendue, images et appels réseau toujours OK).
