# Roadmap — Intégration de fonctionnalités inspirées de Stelliverse

## Statut d'avancement

| Phase | État |
| --- | --- |
| **0 — Quick wins Dashboard** (statut serveurs RSI, actualités RSI) | ✅ Livré |
| **1 — Lecteur Game.log** (moteur + auto-lieu GPS + journal commerce + Carnet de bord) | ✅ Livré |
| **2 — Overlay en jeu (F6)** | ✅ Livré |
| **3 — Carte galactique 3D (Three.js)** | ✅ Livré |
| **4 — Compagnon mobile (PWA + serveur local)** | ⏳ Reporté (à faire plus tard) |

> Discord Rich Presence : exclu par décision.
> Vérifications par phase : `cargo check`/tests Rust + `tsc` + `vite build` (verts).

---


> Objectif : ajouter à **SC Fleet Manager V2** les fonctionnalités pertinentes observées
> chez Stelliverse, **réécrites de zéro** dans notre stack (React 19 / TS / Vite / Tailwind +
> Tauri 2 / Rust / SQLite). Aucune reprise de code tiers. On renforce notre positionnement
> « flotte / décision / trading » plutôt que de cloner leur app.
>
> **Hors périmètre** (décidé) : Discord Rich Presence. Également écartés (hors ADN, coût élevé,
> faible synergie) : traduction FR du jeu, éditeur de bindings joystick/vJoy, galerie de persos
> /DNA `.chf`, gestion du cache SC, timers PvP. Ils pourront être rouverts plus tard si besoin.

## Rappels d'architecture (points d'ancrage)

- **Backend Rust** : commandes dans `src-tauri/src/commands/*.rs`, module déclaré dans
  `commands/mod.rs`, enregistrées via `generate_handler![...]` dans `src-tauri/src/main.rs`.
- **Base SQLite** : `tauri-plugin-sql` ; migrations listées comme `Migration { version, … include_str!(...) }`
  dans `main.rs`, fichiers dans `src-tauri/migrations/` (dernière : `0027`). Nouvelles tables → `0028+`.
- **Frontend** : routeur `createMemoryRouter` dans `src/app/routes.tsx`, pages dans `src/pages/`,
  navigation dans `src/components/Layout.tsx`, i18n FR/EN dans `src/i18n/locales/`.
- **Événements** : pattern `emit`/`listen` Tauri déjà utilisé (ex. `navbar:pinned-changed`).
- **Plugins déjà présents** : opener, sql, notification, dialog, autostart, updater, process.

---

## Phase 0 — Quick wins Dashboard (faible effort, valeur immédiate)

Indépendants du reste, livrables en premier comme widgets du `DashboardPage`.

### 0.1 — Statut serveurs RSI en direct
- **Rust** : `commands/rsi_status.rs` → `get_rsi_server_status()` ; appel HTTP `reqwest` vers
  l'endpoint de statut RSI, parse, renvoie `{ platform, persistent_universe, electronic_access, … }`.
- **Front** : widget `RsiStatusWidget` dans le Dashboard (réutilise le système de widgets
  repositionnables existant). Rafraîchissement périodique + pastille verte/orange/rouge.
- **i18n** : clés `dashboard.rsiStatus.*`.
- **Effort** : ½ journée.

### 0.2 — Actualités RSI
- **Rust** : `commands/news.rs` → `get_rsi_news(limit)` ; scrape/flux du fil officiel RSI
  (réutiliser `scraper` déjà en dépendance), cache léger en table `rsi_news` (migration `0028`).
- **Front** : widget « À la une » sur le Dashboard + optionnel page `NewsPage` (`/news`) avec le
  fil par jour. Lien ouvre l'article via `opener`.
- **Effort** : 1 journée.

> Discord Rich Presence : **exclu** par décision.

---

## Phase 1 — Lecteur `Game.log` (pièce maîtresse)

Le moteur qui débloque les usages les plus à forte synergie. À construire en premier dans la phase,
les sous-features 1.2→1.4 s'y branchent ensuite.

### 1.1 — Moteur de lecture & parsing (fondation)
- **Localisation du fichier** : `<Star Citizen>/LIVE/Game.log` (et PTU/EPTU). Réglage du chemin
  d'installation dans Settings (on a déjà la logique de chemin SC côté datamining `Data.p4k` à réutiliser).
- **Rust** : nouveau `commands/gamelog.rs`
  - tâche de fond `tokio` qui *tail* le fichier (lecture incrémentale depuis le dernier offset ;
    gestion rotation/restart du jeu). Option : crate `notify` pour l'éveil sur write, sinon poll 1–2 s.
  - parseur d'événements ligne à ligne → enum `GameLogEvent` : `LocationChange`, `CommodityBuy`,
    `CommoditySell`, `ShipBoarded`, `Death`, `Crimestat`, `MissionComplete`, … (regex `regex` déjà en dép).
  - émet des événements Tauri `gamelog:event` vers le front + persiste l'utile en DB.
- **DB** : migration `0028_gamelog.sql` → tables `gamelog_event` (brut horodaté) et un curseur d'offset
  dans `app_meta`/settings.
- **Settings** : interrupteur « Lecture du Game.log » (off par défaut, opt-in, 100 % local) + bouton
  « rejouer l'historique » (parse complet du fichier existant).
- **Risque** : le format des lignes du `Game.log` évolue avec les patchs → centraliser les regex,
  prévoir des tests sur des échantillons de logs (`src-tauri/tests/`).
- **Effort** : 3–4 journées.

### 1.2 — Auto-détection du lieu → GPS de trading
- À chaque `LocationChange`, exposer `get_current_location()` + événement `gamelog:location`.
- **Front** : `CargoRoutesPage` (GPS de trading) pré-remplit le **point de départ** avec le lieu
  détecté (toujours surchargeable manuellement, override prioritaire comme chez eux).
- **Effort** : 1 journée (le GPS existe déjà).

### 1.3 — Détection cargo (achat/vente) → suggestions + journal
- Sur `CommodityBuy`/`CommoditySell` : notification (plugin `notification` déjà présent) avec
  **suggestion de revente** (croise les prix UEX déjà en base) ; enregistre la transaction.
- **DB** : table `trade_journal` (migration `0029`) : commodité, SCU, prix, lieu, timestamp, profit calculé.
- **Front** : onglet/section « Journal » dans `CargoRoutesPage` (P&L des trajets réels).
- **Effort** : 2 journées.

### 1.4 — Carnet de bord (module « Journal »)
- Agrège les `GameLogEvent` en vues thématiques : **économie** (achats/ventes/profit), **vaisseaux**
  utilisés, **crimestat & survie**, **morts**, **social**, plus des **entrées manuelles**.
- **DB** : table `journal_manual_entry` (migration `0030`).
- **Front** : nouvelle page `JournalPage` (`/journal`), entrée dans la navbar, widget « Activité
  récente » sur le Dashboard.
- **i18n** : namespace `journal.*`.
- **Effort** : 3 journées.

---

## Phase 2 — Overlay en jeu (feature signature)

Afficher **notre GPS de trading / prochaine étape de route** par-dessus le jeu en plein écran.

- **Rust/Tauri** : seconde `WebviewWindow` `overlay` : `always_on_top`, `decorations:false`,
  `transparent:true`, `skip_taskbar`, `focus:false` (ne jamais voler le focus au jeu).
  - raccourci global **F6** (toggle) via `tauri-plugin-global-shortcut` (**nouvelle dépendance**).
  - sous Windows, flags `WS_EX_NOACTIVATE`/`WS_EX_TOOLWINDOW` au besoin pour le non-vol de focus.
- **Front** : route/entrée dédiée `overlay.html` (ou route React isolée) — HUD sobre : étape de
  route courante (issue de 1.2/1.3), mini-carte du trajet, alertes assurance/loc qui expirent.
  Données poussées via événements Tauri depuis la fenêtre principale.
- **Réglages** : activer/désactiver, opacité, position, tuiles affichées.
- **Risques** : comportement always-on-top vs jeu fullscreen exclusif (privilégier *borderless*),
  multi-écran. Prévoir une fenêtre « clic-traversant » optionnelle.
- **Effort** : 4–5 journées.

---

## Phase 3 — Carte galactique 3D (Three.js)

Enrichir la `StarmapPage` existante (données starmap déjà en base) d'une vue 3D.

- **Front** : dépendances `three` + `@react-three/fiber` + `@react-three/drei`.
  - navigation système → planète → POI de surface ; points de saut ; fiche de lieu (boutiques, prix UEX).
  - réutiliser `src-tauri/assets/starmap-bodies/*` et les données `0021_starmap_wiki`.
  - bascule 2D existante ⇄ 3D ; lazy-load du bundle 3D pour ne pas alourdir le démarrage.
- **Risques** : poids du bundle (code-splitting), perf sur petites configs (niveaux de détail).
- **Effort** : 4–6 journées.

---

## Phase 4 — Compagnon mobile (PWA + serveur local)

Consulter flotte / routes / journal depuis le téléphone, sur le réseau local. Plus grosse archi.

- **Rust** : `commands/companion_server.rs` — serveur HTTP local **`axum`** (**nouvelle dépendance**,
  + `tokio` déjà présent) exposant une API lecture seule (flotte, routes, journal, statut) + WebSocket
  pour le temps réel. Démarrage opt-in depuis les Settings ; port configurable ; **QR code** d'appairage.
- **PWA** : petite app statique servie par le serveur (peut réutiliser des composants React partagés
  ou un bundle léger dédié). Manifest + service worker pour le mode hors-ligne.
- **Sécurité** : limité au LAN, token d'appairage, lecture seule par défaut. CSP stricte.
- **Risques** : pare-feu Windows (prompt au 1er lancement), découverte d'IP, sécurité d'exposition.
- **Effort** : 6–8 journées.

---

## Séquencement recommandé

1. **Phase 0** (quick wins) — visible tout de suite, sans risque.
2. **Phase 1** — keystone `Game.log` : 1.1 d'abord, puis 1.2 → 1.3 → 1.4.
3. **Phase 2** — overlay GPS (s'appuie sur 1.2/1.3).
4. **Phase 3** — carte 3D (indépendante, peut être parallélisée).
5. **Phase 4** — compagnon mobile (dernier, plus lourd).

## Nouvelles dépendances à introduire

| Dépendance | Phase | Côté |
|---|---|---|
| `notify` (ou poll `tokio`) | 1 | Rust |
| `tauri-plugin-global-shortcut` | 2 | Rust |
| `three`, `@react-three/fiber`, `@react-three/drei` | 3 | Front |
| `axum` | 4 | Rust |

## Migrations DB prévues

| Version | Objet |
|---|---|
| `0028` | `rsi_news` (cache) + `gamelog_event` + curseur d'offset |
| `0029` | `trade_journal` |
| `0030` | `journal_manual_entry` |

## Principes transverses

- **Opt-in & local d'abord** : lecture `Game.log`, overlay, serveur mobile désactivés par défaut.
- **i18n FR/EN** systématique pour chaque écran ajouté.
- **Aucune reprise de code tiers** ; sources de données publiques uniquement (RSI, UEX, SC Wiki).
- **Tests** sur le parseur `Game.log` (formats sujets à casser à chaque patch SC).
