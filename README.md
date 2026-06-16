<p align="center">
  <img src="src/assets/header.png" alt="SC Fleet Manager — interface principale" width="100%" />
</p>

<h1 align="center">SC Fleet Manager — V2</h1>

<p align="center">
  Application desktop pour <b>Star Citizen</b> : gestion de flotte, assurances, CCU, configurateur,
  routes cargo, missions, crafting et carte galactique — synchronisées depuis ton compte RSI.
</p>

<p align="center">
  <a href="https://github.com/elios134/sc-fleet-manager-v2/releases/latest">
    <img src="https://img.shields.io/github/v/release/elios134/sc-fleet-manager-v2?style=for-the-badge&logo=github&logoColor=white&label=Release" alt="Release" />
  </a>
  <img src="https://img.shields.io/badge/Windows-NSIS-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Updater-auto%20%26%20sign%C3%A9-2ea44f?style=for-the-badge&logo=tauri&logoColor=white" alt="Updater signé" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind v4" />
  <img src="https://img.shields.io/badge/SQLite-tauri--plugin--sql-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
</p>

---

## Présentation

SC Fleet Manager se connecte à ton compte **RSI**, importe ton hangar (pledges, vaisseaux,
objets, niveau concierge) et enrichit le tout avec des données de jeu (SC Wiki, UEX, datamining
local). Au **premier setup**, une synchronisation automatique enchaîne toutes les sources ;
ensuite, tout est consultable hors-ligne depuis une base SQLite locale.

Multi-comptes, multilingue (**FR / EN**), thème accent personnalisable, et **mises à jour
automatiques signées**.

<!-- DÉMO VIDÉO (demo-pages.mp4) : glisse le fichier dans l'éditeur du README sur
     github.com (ou une issue brouillon), copie l'URL https://github.com/user-attachments/assets/…
     générée, et colle-la ci-dessous SEULE sur sa propre ligne → GitHub l'affiche en lecteur.

https://github.com/user-attachments/assets/XXXXXXXX

-->

---

## Personnalisation du thème

Dans **Réglages → Apparence**, l'interface s'adapte en direct :

- **Couleur d'accent** — boutons, liens et surbrillances de toute l'application
- **Fond étoilé animé** — activation et densité des étoiles
- Réglages persistés, appliqués immédiatement sur toutes les pages

<p align="center">
  <img src="src/assets/demo-theme.png" alt="Réglages d'apparence — accent et fond étoilé" width="100%" />
</p>

---

## Fonctionnalités

| Page | Description |
| --- | --- |
| **Tableau de bord** | Widgets librement plaçables (drag & drop) : valeur/compteur de flotte, assurances, missions reco, suggestion CCU, locations qui expirent, top routes rentables, carte galactique embarquée |
| **Ma flotte** | Hangar importé depuis RSI : vaisseaux, packs, valeurs, vaisseaux loués (compte à rebours), ajout manuel |
| **Suivi d'assurance** | Échéances LTI / mois, tri par urgence |
| **Comparateur** | Comparaison de deux vaisseaux (specs, radar) — flotte + catalogue |
| **Configurateur (Loadout)** | Édition des points d'emport (armes, boucliers, propulsion…), profils sauvegardés, stats calculées |
| **CCU Chain** | Planificateur de chaînes d'upgrade CCU (programmation dynamique) depuis le catalogue RSI |
| **Mission Intel / Hub** | Catalogue des missions, récompenses, réputation, objectifs & favoris |
| **Crafting Hub** | Blueprints (recettes, ingrédients, stats), suivi des plans possédés |
| **Cargo & Routes** | Planificateur de routes commerciales rentables (profit/min, temps de trajet via les Quantum Drives) + grille de soute |
| **Carte galactique** | Starmap interactive (systèmes, corps, POI) issue du datamining |
| **Objets & cosmétiques** | Items du hangar RSI (skins, équipement FPS, composants…) |
| **Datamining** | Extraction locale via StarBreaker depuis ton installation Star Citizen (`Data.p4k`) — enrichit noms, blueprints, gisements miniers et carte galactique |
| **Réglages** | Apparence (couleur d'accent, fond étoilé), comptes RSI, synchronisations manuelles, lancement au démarrage, mises à jour |

---

## Sources de données

| Source | Usage |
| --- | --- |
| **RSI** (robertsspaceindustries.com) | Login + scrape du hangar (pledges, concierge), catalogue CCU |
| **SC Wiki API** (api.star-citizen.wiki) | Vaisseaux, composants, missions, blueprints, localisations |
| **UEX** (uexcorp.uk) + **Trade Tools** (sc-trade.tools) | Prix marchands & référentiel cargo pour les routes |
| **StarBreaker** (datamining local) | Données extraites de `Data.p4k` (starmap, minage, stats de craft) — 100 % sur ta machine |

Tout est stocké localement dans une base **SQLite** (`scfleet.db`, ~20 migrations) ; rien n'est
envoyé à un tiers en dehors des API publiques ci-dessus.

---

## Stack technique

- **Frontend** — React 19, TypeScript (strict), Vite 7, Tailwind CSS v4, React Router 7,
  i18next (FR/EN), Recharts, dnd-kit, lucide-react.
- **Backend** — Rust + **Tauri 2**, `tauri-plugin-sql` (SQLite), plugins `updater`,
  `autostart`, `notification`, `dialog`, `process`, `opener`. ~23 modules de commandes.
- **Mise à jour** — installeur **NSIS** (Windows) + updater Tauri **signé** (clé minisign),
  `latest.json` publié sur les GitHub Releases.

---

## Développement

> Prérequis : [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stable, et les
> [dépendances Tauri](https://tauri.app/start/prerequisites/) (WebView2 sous Windows).

```bash
git clone https://github.com/elios134/sc-fleet-manager-v2.git
cd sc-fleet-manager-v2
npm install
npm run tauri dev
```

Build d'un installeur Windows :

```bash
npm run tauri build -- --bundles nsis
# → src-tauri/target/release/bundle/nsis/
```

---

## Release & mises à jour

La publication est automatisée par **GitHub Actions** (`.github/workflows/release.yml`),
déclenchée au push d'un tag `vX.Y.Z` (qui doit correspondre à la `version` de
`src-tauri/tauri.conf.json`) :

1. build de l'installeur NSIS,
2. signature de l'artifact updater (secrets `TAURI_SIGNING_PRIVATE_KEY` / `…_PASSWORD`),
3. création de la **GitHub Release** avec `setup.exe`, `.sig` et `latest.json`.

L'application vérifie au démarrage (et depuis **Réglages → À propos**) la présence d'une
nouvelle version, télécharge l'installeur signé, vérifie la signature, puis se relance.

---

## Téléchargement

<p align="center">
  <a href="https://github.com/elios134/sc-fleet-manager-v2/releases/latest">
    <img src="https://img.shields.io/badge/T%C3%A9l%C3%A9charger-derni%C3%A8re%20release-2ea44f?style=for-the-badge&logo=github" alt="Télécharger la dernière release" />
  </a>
</p>

> Windows peut afficher un avertissement **SmartScreen** (l'installeur n'est pas signé par un
> certificat éditeur). L'updater Tauri, lui, vérifie sa propre signature minisign.

---

<p align="center">
  <sub>Projet personnel — Star Citizen® est une marque de Cloud Imperium Games. Cette application
  n'est ni affiliée ni soutenue par CIG.</sub>
</p>
