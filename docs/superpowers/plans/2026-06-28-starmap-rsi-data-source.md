# Starmap RSI Data Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de l'API RSI Starmap la source de vérité de la table `StarmapBody`, en restant rétro-compatible avec la carte 2D et en stockant les champs natifs (longitude orbitale, appearance…) nécessaires au futur rendu 3D.

**Architecture:** Une fonction de mapping pure `map_rsi_system` (RSI JSON → lignes) testée sur fixture, une fonction d'écriture `write_starmap_rows` (clear-then-recreate + garde-fou) testée en SQLite mémoire, un `sync_starmap_from_rsi_core` réseau (reqwest) qui assemble les deux, une tâche de fond `spawn_starmap_sync` qui rafraîchit au lancement si périmé, et un bouton dans Réglages. Tout vit dans `commands/datamining.rs` (à côté du sync Wiki existant) pour réutiliser `StarmapSyncResult`, `roman_to_int`, `DB_URL`, `DbPool`.

**Tech Stack:** Rust (Tauri 2, sqlx/SQLite, reqwest, serde_json, tokio), React/TypeScript (SettingsPage).

## Global Constraints

- **Clean-room** : aucune réutilisation de code/asset Stelliverse (AGPL). On lit l'API RSI publique uniquement.
- **3 systèmes** : `["STANTON","PYRO","NYX"]` (codes API en MAJUSCULES ; `systemName` stocké en minuscules).
- **Rétro-compat 2D** : `posX/Y/Z` recalculés à chaque sync ; jointure parent↔enfant via `wikiUuid = rsi-{id}` et `parentRef = rsi-{parent_id}` (le moteur 2D `bodyKey = wikiUuid ?? stem(recordName)`). Ne PAS modifier `StarmapCanvas.tsx`.
- **Garde-fou 0-objet** : si la source renvoie 0 ligne, ne PAS vider `StarmapBody`.
- **Réseau best-effort** : l'auto-sync ne doit jamais être fatal au démarrage (erreurs journalisées via `eprintln!`).
- **UA navigateur** : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`.
- **`source = 'rsi'`** pour toutes les lignes écrites par ce sync.
- **Endpoint** : `POST https://robertsspaceindustries.com/api/starmap/star-systems/{CODE}`, header `Content-Type: application/json`, corps `"{}"`. Réponse : `data.resultset[0].celestial_objects[]`.

---

## File Structure

- `src-tauri/migrations/0031_starmap_rsi.sql` — **créé** : 7 colonnes `ALTER TABLE StarmapBody`.
- `src-tauri/src/main.rs` — **modifié** : enregistre la migration v31, la commande `sync_starmap_from_rsi`, et l'appel `spawn_starmap_sync` dans `setup()`.
- `src-tauri/src/commands/datamining.rs` — **modifié** : `rsi_nav_icon`, `StarmapRsiRow`, `map_rsi_system`, `write_starmap_rows`, `needs_resync`, `sync_starmap_from_rsi_core`, `sync_starmap_from_rsi` (commande), `spawn_starmap_sync`, + tests.
- `src/pages/SettingsPage.tsx` — **modifié** : `syncStarmapRsi()` + bouton, réutilise l'affichage `starmapResult`.

---

## Task 1: Migration 0031 (colonnes RSI)

**Files:**
- Create: `src-tauri/migrations/0031_starmap_rsi.sql`
- Modify: `src-tauri/src/main.rs:54` (après la ligne `version: 30`)
- Test: `src-tauri/src/commands/datamining.rs` (module `#[cfg(test)]` en fin de fichier)

**Interfaces:**
- Produces: colonnes `distance, longitude, latitude, subtype, appearance, habitable, affColor` sur `StarmapBody`.

- [ ] **Step 1: Write the failing test**

Ajouter en fin de `datamining.rs`, dans (ou en créant) le module de test :

```rust
#[cfg(test)]
mod starmap_rsi_tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;

    #[tokio::test]
    async fn migration_0031_adds_columns() {
        // max_connections(1) : sinon chaque connexion du pool ouvre une base mémoire DISTINCTE.
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE StarmapBody (id TEXT PRIMARY KEY)").execute(&pool).await.unwrap();
        let sql = include_str!("../../migrations/0031_starmap_rsi.sql");
        for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            sqlx::query(stmt).execute(&pool).await.unwrap();
        }
        let cols: Vec<String> = sqlx::query("PRAGMA table_info(StarmapBody)")
            .fetch_all(&pool).await.unwrap()
            .iter().map(|r| r.get::<String, _>("name")).collect();
        for c in ["distance","longitude","latitude","subtype","appearance","habitable","affColor"] {
            assert!(cols.contains(&c.to_string()), "colonne manquante : {c}");
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test starmap_rsi_tests::migration_0031 -- --nocapture`
Expected: FAIL à la compilation (`include_str!` ne trouve pas le fichier) ou à l'exécution (colonnes absentes).

- [ ] **Step 3: Create the migration file**

`src-tauri/migrations/0031_starmap_rsi.sql` :

```sql
-- STARMAP Sous-projet A — bascule de source vers l'API RSI Starmap.
-- Colonnes natives polaires + visuelles. Toutes nullable (rétro-compatibles).
-- posX/Y/Z (déjà présentes) sont recalculées par le sync RSI depuis distance/longitude/latitude.
ALTER TABLE StarmapBody ADD COLUMN distance   REAL;
ALTER TABLE StarmapBody ADD COLUMN longitude  REAL;
ALTER TABLE StarmapBody ADD COLUMN latitude   REAL;
ALTER TABLE StarmapBody ADD COLUMN subtype    TEXT;
ALTER TABLE StarmapBody ADD COLUMN appearance TEXT;
ALTER TABLE StarmapBody ADD COLUMN habitable  INTEGER;
ALTER TABLE StarmapBody ADD COLUMN affColor   TEXT;
```

- [ ] **Step 4: Register the migration in main.rs**

Après la ligne `Migration { version: 30, ... }` (`src-tauri/src/main.rs:54`), ajouter :

```rust
        Migration { version: 31, description: "starmap_rsi", sql: include_str!("../migrations/0031_starmap_rsi.sql"), kind: MigrationKind::Up },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test starmap_rsi_tests::migration_0031 -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/0031_starmap_rsi.sql src-tauri/src/main.rs src-tauri/src/commands/datamining.rs
git commit -m "feat(starmap): migration 0031 — colonnes RSI sur StarmapBody"
```

---

## Task 2: Mapping pur `map_rsi_system`

**Files:**
- Modify: `src-tauri/src/commands/datamining.rs` (ajouts près du sync Wiki, ~ligne 1380 pour les helpers)
- Test: `src-tauri/src/commands/datamining.rs` (module `starmap_rsi_tests`)

**Interfaces:**
- Consumes: `roman_to_int(&str) -> Option<i64>` (existant, `datamining.rs:1394`).
- Produces:
  - `fn rsi_nav_icon(type_: &str) -> Option<&'static str>`
  - `struct StarmapRsiRow { id, wiki_uuid, record_name: String, system, nav_icon, name: String, description, subtype, appearance, aff_color: Option<String>, size, distance, longitude, latitude, pos_x, pos_y, pos_z: Option<f64>, habitable, orbit_order: Option<i64>, parent_ref: Option<String>, show_orbit: bool }`
  - `fn map_rsi_system(code: &str, json: &serde_json::Value) -> Vec<StarmapRsiRow>`

- [ ] **Step 1: Write the failing tests**

Dans le module `starmap_rsi_tests`, ajouter la fixture et les assertions :

```rust
    use super::{map_rsi_system, StarmapRsiRow};
    use serde_json::json;

    fn fixture() -> serde_json::Value {
        json!({"data":{"resultset":[{"celestial_objects":[
            {"id":1691,"parent_id":null,"type":"STAR","name":null,"designation":"Stanton","distance":0,"longitude":0,"latitude":0,"size":1.2},
            {"id":1692,"parent_id":1691,"type":"PLANET","name":"microTech","designation":"Stanton IV","distance":100,"longitude":0,"latitude":0,"size":10328,"habitable":true,"appearance":"PLANET_GREEN","subtype":{"name":"Super-Earth"},"description":"desc"},
            {"id":2737,"parent_id":1692,"type":"SATELLITE","name":"Calliope","designation":"Stanton 4a","distance":10,"longitude":180,"latitude":0,"size":300},
            {"id":1689,"parent_id":null,"type":"JUMPPOINT","name":null,"designation":"Stanton - Pyro","distance":50,"longitude":90,"latitude":0},
            {"id":1698,"parent_id":1691,"type":"ASTEROID_BELT","name":"Aaron Halo","designation":null,"distance":60,"longitude":0,"latitude":0},
            {"id":9001,"parent_id":1692,"type":"MANMADE","name":"Port Tressler","designation":null,"distance":3,"longitude":45,"latitude":0}
        ]}]}})
    }
    fn find<'a>(rows: &'a [StarmapRsiRow], id: &str) -> &'a StarmapRsiRow {
        rows.iter().find(|r| r.id == id).expect("ligne absente")
    }
    fn approx(a: Option<f64>, b: f64) { assert!((a.unwrap() - b).abs() < 1e-6, "{:?} != {b}", a); }

    #[test]
    fn maps_types_to_nav_icons() {
        let rows = map_rsi_system("STANTON", &fixture());
        assert_eq!(rows.len(), 6);
        assert_eq!(find(&rows, "rsi-1691").nav_icon, "Star");
        assert_eq!(find(&rows, "rsi-1692").nav_icon, "Planet");
        assert_eq!(find(&rows, "rsi-2737").nav_icon, "Moon");
        assert_eq!(find(&rows, "rsi-1689").nav_icon, "Jumppoint");
        assert_eq!(find(&rows, "rsi-1698").nav_icon, "AsteroidBelt");
        assert_eq!(find(&rows, "rsi-9001").nav_icon, "Station");
    }
    #[test]
    fn record_name_and_system_lowercase() {
        let rows = map_rsi_system("STANTON", &fixture());
        assert_eq!(find(&rows, "rsi-1691").record_name, "stantonstar");
        assert_eq!(find(&rows, "rsi-1692").record_name, "stanton4"); // Stanton IV → 4
        assert_eq!(find(&rows, "rsi-1692").system, "stanton");
    }
    #[test]
    fn hierarchy_join_key_matches_parent_wikiuuid() {
        let rows = map_rsi_system("STANTON", &fixture());
        let moon = find(&rows, "rsi-2737");
        let planet = find(&rows, "rsi-1692");
        assert_eq!(moon.parent_ref.as_deref(), Some(planet.wiki_uuid.as_str()));
        assert_eq!(planet.wiki_uuid, "rsi-1692");
        assert_eq!(find(&rows, "rsi-1691").parent_ref, None);
    }
    #[test]
    fn derives_positions() {
        let rows = map_rsi_system("STANTON", &fixture());
        approx(find(&rows, "rsi-1691").pos_x, 0.0);   // étoile au centre
        approx(find(&rows, "rsi-1692").pos_x, 100.0); // planète lon=0 → x=distance
        approx(find(&rows, "rsi-1692").pos_y, 0.0);
        approx(find(&rows, "rsi-2737").pos_x, 90.0);  // planète(100) + lune local(lon180 → -10)
    }
    #[test]
    fn rich_fields_and_guard() {
        let rows = map_rsi_system("STANTON", &fixture());
        let p = find(&rows, "rsi-1692");
        assert_eq!(p.habitable, Some(1));
        assert_eq!(p.appearance.as_deref(), Some("PLANET_GREEN"));
        assert_eq!(p.subtype.as_deref(), Some("Super-Earth"));
        assert_eq!(p.orbit_order, Some(4));
        assert!(map_rsi_system("STANTON", &serde_json::json!({})).is_empty()); // garde-fou
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test starmap_rsi_tests -- --nocapture`
Expected: FAIL à la compilation (`map_rsi_system`, `StarmapRsiRow` inconnus).

- [ ] **Step 3: Implement `rsi_nav_icon`, `StarmapRsiRow`, `map_rsi_system`**

Ajouter dans `datamining.rs` (après `roman_to_int`, ~ligne 1419) :

```rust
/// type RSI → navIcon. Jumppoint/AsteroidBelt sont nouveaux (ignorés par la 2D, gérés par la 3D).
fn rsi_nav_icon(type_: &str) -> Option<&'static str> {
    match type_ {
        "STAR" => Some("Star"),
        "PLANET" => Some("Planet"),
        "SATELLITE" => Some("Moon"),
        "MANMADE" => Some("Station"),
        "JUMPPOINT" => Some("Jumppoint"),
        "ASTEROID_BELT" => Some("AsteroidBelt"),
        _ => None,
    }
}

pub struct StarmapRsiRow {
    pub id: String,
    pub wiki_uuid: String,
    pub record_name: String,
    pub system: String,
    pub nav_icon: String,
    pub name: String,
    pub description: Option<String>,
    pub subtype: Option<String>,
    pub appearance: Option<String>,
    pub aff_color: Option<String>,
    pub size: Option<f64>,
    pub distance: Option<f64>,
    pub longitude: Option<f64>,
    pub latitude: Option<f64>,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
    pub pos_z: Option<f64>,
    pub habitable: Option<i64>,
    pub orbit_order: Option<i64>,
    pub parent_ref: Option<String>,
    pub show_orbit: bool,
}

/// Vecteur local d'un objet depuis ses (distance, longitude, latitude).
fn rsi_local_pos(o: &serde_json::Value) -> (f64, f64, f64) {
    let d = o.get("distance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lon = o.get("longitude").and_then(|v| v.as_f64()).unwrap_or(0.0).to_radians();
    let lat = o.get("latitude").and_then(|v| v.as_f64()).unwrap_or(0.0).to_radians();
    (d * lon.cos() * lat.cos(), d * lon.sin() * lat.cos(), d * lat.sin())
}

/// Position ABSOLUE intra-système (résolution récursive parent + local, mémoïsée).
fn rsi_abs_pos(
    id: i64,
    by_id: &std::collections::HashMap<i64, serde_json::Value>,
    memo: &mut std::collections::HashMap<i64, (f64, f64, f64)>,
) -> (f64, f64, f64) {
    if let Some(p) = memo.get(&id) {
        return *p;
    }
    let o = match by_id.get(&id) {
        Some(o) => o,
        None => return (0.0, 0.0, 0.0),
    };
    let local = rsi_local_pos(o);
    let abs = match o.get("parent_id").and_then(|v| v.as_i64()) {
        Some(pid) => {
            let pp = rsi_abs_pos(pid, by_id, memo);
            (pp.0 + local.0, pp.1 + local.1, pp.2 + local.2)
        }
        None => local, // niveau étoile : local (l'étoile a distance 0 → origine)
    };
    memo.insert(id, abs);
    abs
}

/// Mapping pur RSI → lignes StarmapBody. Aucun réseau, aucune DB.
/// Garde-fou : JSON sans celestial_objects → Vec vide (l'appelant ne videra pas la table).
pub fn map_rsi_system(code: &str, json: &serde_json::Value) -> Vec<StarmapRsiRow> {
    let objs = json
        .get("data").and_then(|v| v.get("resultset"))
        .and_then(|v| v.get(0)).and_then(|v| v.get("celestial_objects"))
        .and_then(|v| v.as_array());
    let Some(objs) = objs else { return Vec::new() };

    let system = code.to_lowercase();
    let by_id: std::collections::HashMap<i64, serde_json::Value> = objs
        .iter()
        .filter_map(|o| o.get("id").and_then(|v| v.as_i64()).map(|id| (id, o.clone())))
        .collect();
    let mut memo = std::collections::HashMap::new();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rows = Vec::new();

    for o in objs {
        let Some(id) = o.get("id").and_then(|v| v.as_i64()) else { continue };
        let type_ = o.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let Some(nav_icon) = rsi_nav_icon(type_) else { continue };

        let designation = o.get("designation").and_then(|v| v.as_str()).map(str::to_string);
        let name = o.get("name").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| designation.clone())
            .unwrap_or_else(|| format!("rsi-{id}"));
        let orbit_order = designation.as_deref().and_then(roman_to_int);

        let mut record_name = match nav_icon {
            "Star" => format!("{system}star"),
            "Planet" => match orbit_order {
                Some(n) => format!("{system}{n}"),
                None => format!("rsi-{id}"),
            },
            _ => format!("rsi-{id}"),
        };
        if !used.insert(record_name.clone()) {
            record_name = format!("rsi-{id}");
            used.insert(record_name.clone());
        }

        let (px, py, pz) = rsi_abs_pos(id, &by_id, &mut memo);
        // aff_color : best-effort (affiliation au format tableau [{color}] ; sinon None).
        let aff_color = o.get("affiliation")
            .and_then(|a| a.get(0)).and_then(|a| a.get("color"))
            .and_then(|v| v.as_str()).map(str::to_string);

        rows.push(StarmapRsiRow {
            id: format!("rsi-{id}"),
            wiki_uuid: format!("rsi-{id}"),
            record_name,
            system: system.clone(),
            nav_icon: nav_icon.to_string(),
            name,
            description: o.get("description").and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty()).map(str::to_string),
            subtype: o.get("subtype").and_then(|v| v.get("name")).and_then(|v| v.as_str()).map(str::to_string),
            appearance: o.get("appearance").and_then(|v| v.as_str())
                .filter(|s| !s.is_empty() && *s != "DEFAULT").map(str::to_string),
            aff_color,
            size: o.get("size").and_then(|v| v.as_f64()),
            distance: o.get("distance").and_then(|v| v.as_f64()),
            longitude: o.get("longitude").and_then(|v| v.as_f64()),
            latitude: o.get("latitude").and_then(|v| v.as_f64()),
            pos_x: Some(px),
            pos_y: Some(py),
            pos_z: Some(pz),
            habitable: o.get("habitable").and_then(|v| v.as_bool()).map(i64::from),
            orbit_order,
            parent_ref: o.get("parent_id").and_then(|v| v.as_i64()).map(|p| format!("rsi-{p}")),
            show_orbit: matches!(nav_icon, "Planet" | "Moon" | "Station"),
        });
    }
    rows
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test starmap_rsi_tests -- --nocapture`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/datamining.rs
git commit -m "feat(starmap): mapping pur RSI -> StarmapBody (map_rsi_system) + tests"
```

---

## Task 3: Écriture `write_starmap_rows` (+ garde-fou)

**Files:**
- Modify: `src-tauri/src/commands/datamining.rs`
- Test: `src-tauri/src/commands/datamining.rs` (module `starmap_rsi_tests`)

**Interfaces:**
- Consumes: `StarmapRsiRow` (Task 2), `StarmapSyncResult` (existant `datamining.rs:1128`).
- Produces: `async fn write_starmap_rows(pool: &sqlx::SqlitePool, rows: &[StarmapRsiRow]) -> Result<StarmapSyncResult, String>` — vide puis réécrit `StarmapBody` en transaction ; si `rows` est vide, **ne touche pas** la table et renvoie `Err`.

- [ ] **Step 1: Write the failing test**

Le test crée une `StarmapBody` minimale (schéma 0008 réduit + colonnes 0031) en mémoire :

```rust
    use super::write_starmap_rows;

    async fn mem_db_with_starmap() -> sqlx::SqlitePool {
        // max_connections(1) : base mémoire partagée par toutes les requêtes du test.
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE StarmapBody (id TEXT PRIMARY KEY, recordName TEXT UNIQUE, systemName TEXT,
             navIcon TEXT, name TEXT, description TEXT, size REAL, parentRef TEXT,
             hideInStarmap INTEGER DEFAULT 0, showOrbitLine INTEGER DEFAULT 0, orbitOrder INTEGER,
             source TEXT, lastSyncedAt TEXT, wikiUuid TEXT, posX REAL, posY REAL, posZ REAL,
             distance REAL, longitude REAL, latitude REAL, subtype TEXT, appearance TEXT,
             habitable INTEGER, affColor TEXT)"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn writes_rows_and_preserves_hierarchy() {
        let pool = mem_db_with_starmap().await;
        let rows = map_rsi_system("STANTON", &fixture());
        let res = write_starmap_rows(&pool, &rows).await.unwrap();
        assert_eq!(res.bodies_written, 6);
        // jointure parentRef(lune) = wikiUuid(planète)
        let joined: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM StarmapBody c JOIN StarmapBody p ON c.parentRef = p.wikiUuid
             WHERE c.id = 'rsi-2737' AND p.id = 'rsi-1692'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(joined, 1);
    }

    #[tokio::test]
    async fn guard_empty_rows_keeps_table() {
        let pool = mem_db_with_starmap().await;
        sqlx::query("INSERT INTO StarmapBody (id, recordName, systemName, navIcon, name, source) \
                     VALUES ('x','x','stanton','Star','X','wiki')").execute(&pool).await.unwrap();
        let err = write_starmap_rows(&pool, &[]).await;
        assert!(err.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM StarmapBody").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1, "la table ne doit pas être vidée");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test starmap_rsi_tests::writes_rows starmap_rsi_tests::guard_empty -- --nocapture`
Expected: FAIL à la compilation (`write_starmap_rows` inconnue).

- [ ] **Step 3: Implement `write_starmap_rows`**

Dans `datamining.rs` (après `map_rsi_system`) :

```rust
/// Réécrit StarmapBody depuis des lignes RSI (transaction, clear-then-recreate).
/// Garde-fou : rows vide → la table n'est PAS touchée, renvoie Err.
pub async fn write_starmap_rows(
    pool: &sqlx::SqlitePool,
    rows: &[StarmapRsiRow],
) -> Result<StarmapSyncResult, String> {
    if rows.is_empty() {
        return Err("starmap RSI : 0 corps — StarmapBody conservé".into());
    }
    let mut res = StarmapSyncResult::default();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM StarmapBody").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    for r in rows {
        sqlx::query(
            "INSERT INTO StarmapBody
               (id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, wikiUuid,
                posX, posY, posZ, distance, longitude, latitude, subtype, appearance, habitable, affColor)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'rsi', datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&r.id).bind(&r.record_name).bind(&r.system).bind(&r.nav_icon).bind(&r.name)
        .bind(&r.description).bind(r.size).bind(&r.parent_ref)
        .bind(i64::from(r.show_orbit)).bind(r.orbit_order).bind(&r.wiki_uuid)
        .bind(r.pos_x).bind(r.pos_y).bind(r.pos_z)
        .bind(r.distance).bind(r.longitude).bind(r.latitude)
        .bind(&r.subtype).bind(&r.appearance).bind(r.habitable).bind(&r.aff_color)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
        res.bodies_written += 1;
        match r.system.as_str() {
            "stanton" => res.stanton += 1,
            "pyro" => res.pyro += 1,
            "nyx" => res.nyx += 1,
            _ => {}
        }
        *res.by_type.entry(r.nav_icon.clone()).or_insert(0) += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(res)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test starmap_rsi_tests -- --nocapture`
Expected: PASS (8 tests au total).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/datamining.rs
git commit -m "feat(starmap): write_starmap_rows (transaction + garde-fou) + tests"
```

---

## Task 4: Sync réseau `sync_starmap_from_rsi` + commande

**Files:**
- Modify: `src-tauri/src/commands/datamining.rs`
- Modify: `src-tauri/src/main.rs:230` (invoke_handler, après `sync_starmap_from_wiki`)

**Interfaces:**
- Consumes: `map_rsi_system`, `write_starmap_rows`, `DB_URL`, `DbInstances`, `DbPool` (existants).
- Produces:
  - `pub async fn sync_starmap_from_rsi_core(app: &AppHandle) -> Result<StarmapSyncResult, String>`
  - `#[tauri::command] pub async fn sync_starmap_from_rsi(app: AppHandle) -> Result<StarmapSyncResult, String>`

- [ ] **Step 1: Implement the network sync**

Dans `datamining.rs` (réutilise le pattern reqwest de `news.rs:205`) :

```rust
const RSI_STARMAP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RSI_SYSTEMS: [&str; 3] = ["STANTON", "PYRO", "NYX"];

/// Interroge l'API RSI Starmap pour les 3 systèmes, mappe et réécrit StarmapBody.
pub async fn sync_starmap_from_rsi_core(app: &AppHandle) -> Result<StarmapSyncResult, String> {
    let client = reqwest::Client::builder()
        .user_agent(RSI_STARMAP_UA)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let mut rows: Vec<StarmapRsiRow> = Vec::new();
    for code in RSI_SYSTEMS {
        let url = format!("https://robertsspaceindustries.com/api/starmap/star-systems/{code}");
        match client.post(&url).header("Content-Type", "application/json").body("{}").send().await {
            Ok(resp) => match resp.json::<serde_json::Value>().await {
                Ok(json) => rows.extend(map_rsi_system(code, &json)),
                Err(e) => eprintln!("[starmap-rsi] parse {code} échoué : {e}"),
            },
            Err(e) => eprintln!("[starmap-rsi] requête {code} échouée : {e}"),
        }
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let res = write_starmap_rows(pool, &rows).await?;
    eprintln!(
        "[starmap-rsi] STARMAP (RSI) — {} corps (Stanton {}, Pyro {}, Nyx {}) | types {:?}",
        res.bodies_written, res.stanton, res.pyro, res.nyx, res.by_type
    );
    Ok(res)
}

/// Commande exposée : sync manuel depuis Réglages.
#[tauri::command]
pub async fn sync_starmap_from_rsi(app: AppHandle) -> Result<StarmapSyncResult, String> {
    sync_starmap_from_rsi_core(&app).await
}
```

- [ ] **Step 2: Register the command in main.rs**

Dans `invoke_handler!` de `src-tauri/src/main.rs` (après `commands::datamining::sync_starmap_from_wiki,` ligne 230) :

```rust
            commands::datamining::sync_starmap_from_rsi,
```

- [ ] **Step 3: Verify it compiles + smoke test**

Run: `cd src-tauri && cargo check`
Expected: compile sans erreur.

Smoke manuel (réseau réel, à faire une fois) : lancer l'app (`npm run tauri dev`), ouvrir la console et exécuter `window.__TAURI__.core.invoke('sync_starmap_from_rsi')`. Attendu : un objet `{bodiesWritten: >0, stanton: >0, pyro: >0, nyx: >0}` et la carte 2D toujours fonctionnelle.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/datamining.rs src-tauri/src/main.rs
git commit -m "feat(starmap): sync_starmap_from_rsi (reqwest API RSI) + commande exposée"
```

---

## Task 5: Auto-sync périodique `spawn_starmap_sync`

**Files:**
- Modify: `src-tauri/src/commands/datamining.rs`
- Modify: `src-tauri/src/main.rs` (`setup()`, après `spawn_gamelog_watcher`, ~ligne 85)
- Test: `src-tauri/src/commands/datamining.rs` (module `starmap_rsi_tests`)

**Interfaces:**
- Consumes: `sync_starmap_from_rsi_core`, `sync_starmap_from_wiki_core` (existant), `DbInstances`, `DbPool`.
- Produces:
  - `async fn needs_resync(pool: &sqlx::SqlitePool, max_age_days: i64) -> bool` — true si aucune ligne `source='rsi'` fraîche (`lastSyncedAt > datetime('now','-N days')`).
  - `pub fn spawn_starmap_sync(app: AppHandle)`

- [ ] **Step 1: Write the failing test for `needs_resync`**

```rust
    use super::needs_resync;

    #[tokio::test]
    async fn needs_resync_logic() {
        let pool = mem_db_with_starmap().await;
        assert!(needs_resync(&pool, 7).await, "table vide → resync");
        sqlx::query("INSERT INTO StarmapBody (id, recordName, systemName, navIcon, name, source, lastSyncedAt) \
                     VALUES ('a','a','stanton','Star','A','rsi', datetime('now','-2 days'))")
            .execute(&pool).await.unwrap();
        assert!(!needs_resync(&pool, 7).await, "ligne RSI fraîche → pas de resync");
        sqlx::query("UPDATE StarmapBody SET lastSyncedAt = datetime('now','-10 days')").execute(&pool).await.unwrap();
        assert!(needs_resync(&pool, 7).await, "ligne RSI périmée → resync");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test starmap_rsi_tests::needs_resync_logic -- --nocapture`
Expected: FAIL à la compilation (`needs_resync` inconnue).

- [ ] **Step 3: Implement `needs_resync` + `spawn_starmap_sync`**

```rust
/// True s'il n'existe aucune ligne source='rsi' synchronisée il y a moins de max_age_days jours.
async fn needs_resync(pool: &sqlx::SqlitePool, max_age_days: i64) -> bool {
    let cutoff = format!("-{max_age_days} days");
    let fresh: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM StarmapBody WHERE source='rsi' AND lastSyncedAt > datetime('now', ?)",
    )
    .bind(&cutoff)
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    fresh == 0
}

/// Tâche de fond : rafraîchit la carte depuis l'API RSI au lancement si périmée (>7 j) ou absente,
/// puis re-vérifie toutes les 24 h. Repli Wiki si RSI échoue et que la table est vide. Best-effort.
pub fn spawn_starmap_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(24 * 3600));
        loop {
            ticker.tick().await; // 1er tick immédiat (au lancement)
            let stale = {
                let instances = app.state::<DbInstances>();
                let lock = instances.0.read().await;
                match lock.get(DB_URL) {
                    Some(DbPool::Sqlite(pool)) => needs_resync(pool, 7).await,
                    _ => false,
                }
            };
            if !stale {
                continue;
            }
            if let Err(e) = sync_starmap_from_rsi_core(&app).await {
                eprintln!("[starmap-rsi] auto-sync échoué : {e}");
                // repli Wiki uniquement si la table est vide (sinon on garde l'existant)
                let empty = {
                    let instances = app.state::<DbInstances>();
                    let lock = instances.0.read().await;
                    match lock.get(DB_URL) {
                        Some(DbPool::Sqlite(pool)) => sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM StarmapBody")
                            .fetch_one(pool).await.unwrap_or(0) == 0,
                        _ => false,
                    }
                };
                if empty {
                    if let Err(e2) = sync_starmap_from_wiki_core(&app).await {
                        eprintln!("[starmap-rsi] repli Wiki échoué : {e2}");
                    }
                }
            }
        }
    });
}
```

- [ ] **Step 4: Wire it in main.rs setup()**

Après `commands::gamelog::spawn_gamelog_watcher(app.handle().clone());` (`src-tauri/src/main.rs:85`) :

```rust
            commands::datamining::spawn_starmap_sync(app.handle().clone());
```

- [ ] **Step 5: Run tests + compile**

Run: `cd src-tauri && cargo test starmap_rsi_tests -- --nocapture && cargo check`
Expected: tous les tests PASS, compile sans erreur.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/datamining.rs src-tauri/src/main.rs
git commit -m "feat(starmap): auto-sync RSI périodique au lancement + repli Wiki"
```

---

## Task 6: Bouton « Sync RSI » dans Réglages

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: commande `sync_starmap_from_rsi` (Task 4), type front `StarmapSyncResult` (existant `SettingsPage.tsx:174`), état `starmapResult` / `setStarmapResult`.

- [ ] **Step 1: Add the `syncStarmapRsi` handler**

Juste après la fonction `syncStarmapWiki()` (`SettingsPage.tsx:591`), ajouter (réutilise les mêmes états) :

```tsx
  // Carte galactique depuis l'API RSI Starmap (source de vérité). Réseau côté Rust.
  async function syncStarmapRsi() {
    setSyncingStarmapWiki(true);
    setError(null);
    setStarmapResult(null);
    try {
      const res = await invoke<StarmapSyncResult>("sync_starmap_from_rsi");
      setStarmapResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingStarmapWiki(false);
    }
  }
```

- [ ] **Step 2: Add the button next to the Wiki one**

Juste après le bloc bouton Wiki (le `</button>` à ~`SettingsPage.tsx:1014`, avant le bloc `{starmapResult && (`), ajouter un second bouton :

```tsx
        <button
          type="button"
          className="btn-secondary"
          disabled={syncingStarmapWiki}
          onClick={() => void syncStarmapRsi()}
        >
          {syncingStarmapWiki ? "Synchronisation…" : "Synchroniser la carte (RSI)"}
        </button>
```

(Note : si une clé i18n est préférée, ajouter `settings.donnees.syncStarmapRsiBtn` aux fichiers de traduction et l'utiliser via `t(...)`. Le libellé en dur ci-dessus est un repli acceptable pour un premier jet.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: build TypeScript sans erreur.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(starmap): bouton de synchronisation RSI dans Réglages"
```

---

## Notes d'exécution

- **Ordre des tâches** : 1 → 6, chacune compile et passe ses tests avant commit.
- Le module de test `starmap_rsi_tests` grandit au fil des tâches (1 puis 2, 3, 5) ; garder les `use super::...` en tête du module.
- Après Task 4, le smoke réseau est **manuel** (l'API RSI n'est pas mockée). Les tests automatisés couvrent le mapping (Task 2), l'écriture/garde-fou (Task 3) et la fraîcheur (Task 5).
- Sous-projet B (rendu 3D) consommera `distance/longitude/latitude/appearance/habitable/subtype/affColor` — ne pas les supprimer.
