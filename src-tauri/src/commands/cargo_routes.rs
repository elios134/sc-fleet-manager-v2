// Bloc 4 — Cargo & Routes, Phase A : sync du cache des données de référence.
// PAS d'UI, PAS de calcul de route ici. Uniquement : appels HTTP gratuits +
// remplissage idempotent des tables de la migration 0014.
//
// Objectif final du module = planificateur PROFIT/TEMPS (option b) avec fallback
// marge brute. Cette phase pose le socle :
//   • Trade Tools (prix/catalogues, GET libres)  : commodities, shops, ships.
//   • SC Wiki (lieux + positions x/y/z)           : locations, positions(+jumps).
//   • Mapping lieu Trade Tools → SC Wiki (slug/uuid), pont prix ↔ positions.
//
// ⚠️ SC Wiki EXIGE User-Agent + Accept: application/json (sinon 403).
// ⚠️ L'appel /api/locations/positions (non documenté) est ISOLÉ : son échec
//    n'interrompt pas le reste de la sync (la table positions reste intacte).

use serde::Serialize;
use serde_json::Value;
use sqlx::{Pool, Row, Sqlite};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
const TRADE_BASE: &str = "https://sc-trade.tools";
const WIKI_BASE: &str = "https://api.star-citizen.wiki";

const REQUEST_TIMEOUT_SECS: u64 = 25;
const RATE_LIMIT_DELAY_MS: u64 = 120;

// Hubs validés à l'audit (slug = kebab-case du dernier segment du lieu Trade Tools).
// Sert au contrôle de cohérence post-sync (attendu : 14/14 trouvés en Wiki + position).
const AUDIT_HUB_SLUGS: [&str; 14] = [
    "area18",
    "checkmate",
    "cru-l1-ambitious-dream-station",
    "dudley-daughters",
    "levski",
    "lorville",
    "new-babbage",
    "nyx-gateway",
    "orison",
    "port-tressler",
    "pyro-gateway",
    "ruin-station",
    "seraphim-station",
    "terra-gateway",
];

/* ──────────────────────────────  Helpers  ─────────────────────────────────── */

/// Client HTTP pour SC Trade Tools (User-Agent suffit, GET libres).
fn trade_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())
}

/// Client HTTP pour SC Wiki : User-Agent + Accept: application/json OBLIGATOIRES.
fn wiki_client() -> Result<reqwest::Client, String> {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())
}

/// GET JSON simple (1 retry réseau). Erreur explicite sur statut non-2xx.
async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match client.get(url).send().await {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return r.json::<Value>().await.map_err(|e| e.to_string());
                }
                return Err(format!("HTTP {status} sur {url}"));
            }
            Err(e) => {
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
                return Err(e.to_string());
            }
        }
    }
}

/// Slugify aligné sur Laravel `Str::slug` (utilisé par SC Wiki) : minuscules, on
/// SUPPRIME les caractères qui ne sont ni alphanumériques ni espace/tiret (apostrophes,
/// `&`, `,`…), puis les suites d'espaces/tirets deviennent un seul '-'.
///   "Dudley & Daughters" → "dudley-daughters"
///   "People's Service Station Alpha" → "peoples-service-station-alpha"
///   "CRU-L1 Ambitious Dream Station" → "cru-l1-ambitious-dream-station"
fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if c.is_whitespace() || c == '-' {
            if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        }
        // tout autre caractère (apostrophe, &, ., /, …) est supprimé sans séparateur.
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Dernier segment d'un chemin "A > B > C" (trim), ou la chaîne entière si pas de '>'.
fn leaf_of(path: &str) -> String {
    path.rsplit('>').next().unwrap_or(path).trim().to_string()
}

/// Premier segment d'un chemin "A > B > C", ou None.
fn system_of(path: &str) -> Option<String> {
    let first = path.split('>').next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

/// Acquiert le pool SQLite (les writes se font tant que le guard est vivant).
macro_rules! pool_from {
    ($lock:expr) => {{
        match $lock.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => return Err(format!("Base non chargée : {DB_URL}")),
        }
    }};
}

/* ────────────────────────  Cores : Trade Tools  ───────────────────────────── */

/// /api/commodity/items → CargoCommodity (clear-then-recreate). Renvoie le nb de lignes.
async fn sync_commodities_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/commodity/items");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse commodity/items inattendue (pas un tableau)")?;
    let names: Vec<String> = arr
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoCommodity").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for name in &names {
        sqlx::query("INSERT OR REPLACE INTO CargoCommodity (name, lastSyncedAt) VALUES (?, datetime('now'))")
            .bind(name)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/// /api/commodity/shops → CargoShop (clear-then-recreate). Stocke leaf + système dérivés.
async fn sync_shops_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/commodity/shops");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse commodity/shops inattendue (pas un tableau)")?;
    struct ShopRow {
        name: String,
        leaf: String,
        system: Option<String>,
    }
    let rows: Vec<ShopRow> = arr
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .map(|name| {
            let leaf = leaf_of(&name);
            let system = system_of(&name);
            ShopRow { name, leaf, system }
        })
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoShop").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO CargoShop (name, leaf, systemName, lastSyncedAt)
             VALUES (?, ?, ?, datetime('now'))",
        )
        .bind(&r.name)
        .bind(&r.leaf)
        .bind(&r.system)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/// /api/ships → CargoShipApi (clear-then-recreate). {name, maxBoxSizeInScu}.
async fn sync_ships_api_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/ships");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse ships inattendue (pas un tableau)")?;
    struct ShipRow {
        name: String,
        max_box: Option<i64>,
    }
    let rows: Vec<ShipRow> = arr
        .iter()
        .filter_map(|it| {
            let name = it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string())?;
            if name.is_empty() {
                return None;
            }
            let max_box = it.get("maxBoxSizeInScu").and_then(|v| v.as_i64());
            Some(ShipRow { name, max_box })
        })
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoShipApi").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO CargoShipApi (name, maxBoxSizeInScu, lastSyncedAt)
             VALUES (?, ?, datetime('now'))",
        )
        .bind(&r.name)
        .bind(r.max_box)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/* ────────────────────────────  Cores : SC Wiki  ───────────────────────────── */

/// /api/locations (paginé ?page[number]=) → WikiStarmapLocation (clear-then-recreate).
async fn sync_wiki_locations_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    struct LocRow {
        uuid: String,
        slug: Option<String>,
        name: Option<String>,
        designation: Option<String>,
        type_class: Option<String>,
        parent_name: Option<String>,
        parent_slug: Option<String>,
        system: Option<String>,
    }

    let mut rows: Vec<LocRow> = Vec::new();
    let mut page = 1u32;
    let mut last_page = 1u32;
    loop {
        // Brackets encodés (%5B/%5D) pour ne pas dépendre du parsing d'URL.
        let url = format!("{WIKI_BASE}/api/locations?page%5Bnumber%5D={page}");
        let json = get_json(client, &url).await?;
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for it in arr {
                let Some(uuid) = it.get("uuid").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                    continue;
                };
                let s = |k: &str| it.get(k).and_then(|v| v.as_str()).map(|x| x.to_string());
                let parent = it.get("parent");
                let parent_name = parent.and_then(|p| p.get("name")).and_then(|v| v.as_str()).map(|x| x.to_string());
                let parent_slug = parent.and_then(|p| p.get("slug")).and_then(|v| v.as_str()).map(|x| x.to_string());
                // `type` est un objet {name, classification, ...} ; `system` est une chaîne.
                let type_class = it
                    .get("type")
                    .and_then(|t| t.get("classification").or_else(|| t.get("name")))
                    .and_then(|v| v.as_str())
                    .map(|x| x.to_string());
                rows.push(LocRow {
                    uuid,
                    slug: s("slug"),
                    name: s("name"),
                    designation: s("designation"),
                    type_class,
                    parent_name,
                    parent_slug,
                    system: s("system"),
                });
            }
        }
        if page >= last_page {
            break;
        }
        page += 1;
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiStarmapLocation").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiStarmapLocation
               (uuid, slug, name, designation, typeClassification, parentName, parentSlug, systemName, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&r.uuid)
        .bind(&r.slug)
        .bind(&r.name)
        .bind(&r.designation)
        .bind(&r.type_class)
        .bind(&r.parent_name)
        .bind(&r.parent_slug)
        .bind(&r.system)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PositionsSyncResult {
    pub positions: i64,
    pub connections: i64,
}

/// /api/locations/positions (NON documenté) → WikiLocationPosition + WikiJumpConnection.
/// ISOLÉ : ne touche la DB qu'APRÈS un fetch+parse réussi. Si l'appel échoue, on
/// renvoie Err AVANT tout DELETE → les positions existantes restent intactes.
async fn sync_positions_core(app: &AppHandle, client: &reqwest::Client) -> Result<PositionsSyncResult, String> {
    let url = format!("{WIKI_BASE}/api/locations/positions");
    let json = get_json(client, &url).await?;

    struct PosRow {
        uuid: String,
        name: Option<String>,
        type_: Option<String>,
        system: Option<String>,
        parent_uuid: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        z: Option<f64>,
        qt_valid: bool,
        hidden: bool,
    }
    let data = json.get("data").and_then(|d| d.as_array()).ok_or("positions: champ 'data' absent/invalide")?;
    let mut pos_rows: Vec<PosRow> = Vec::new();
    for it in data {
        let Some(uuid) = it.get("uuid").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
            continue;
        };
        let s = |k: &str| it.get(k).and_then(|v| v.as_str()).map(|x| x.to_string());
        let f = |k: &str| it.get(k).and_then(|v| v.as_f64());
        pos_rows.push(PosRow {
            uuid,
            name: s("name"),
            type_: s("type"),
            system: s("system"),
            parent_uuid: s("parent_uuid"),
            x: f("x"),
            y: f("y"),
            z: f("z"),
            qt_valid: it.get("qt_valid").and_then(|v| v.as_bool()).unwrap_or(false),
            hidden: it.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false),
        });
    }

    struct ConnRow {
        entry: String,
        exit: String,
        entry_sys: Option<String>,
        exit_sys: Option<String>,
        fuel: Option<f64>,
    }
    let mut conn_rows: Vec<ConnRow> = Vec::new();
    if let Some(conns) = json.get("connections").and_then(|c| c.as_array()) {
        for it in conns {
            let entry = it.get("entry_uuid").and_then(|v| v.as_str()).map(|s| s.to_string());
            let exit = it.get("exit_uuid").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let (Some(entry), Some(exit)) = (entry, exit) {
                conn_rows.push(ConnRow {
                    entry,
                    exit,
                    entry_sys: it.get("entry_system").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    exit_sys: it.get("exit_system").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    fuel: it.get("fuel_cost").and_then(|v| v.as_f64()),
                });
            }
        }
    }

    // Garde-fou : un payload soudain vide ne doit pas écraser un cache valide.
    if pos_rows.is_empty() {
        return Err("positions: 0 entité retournée (payload vide) — cache conservé".into());
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiLocationPosition").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiJumpConnection").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    let mut res = PositionsSyncResult::default();
    for r in &pos_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiLocationPosition
               (uuid, name, type, systemName, parentUuid, x, y, z, qtValid, hidden, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&r.uuid)
        .bind(&r.name)
        .bind(&r.type_)
        .bind(&r.system)
        .bind(&r.parent_uuid)
        .bind(r.x)
        .bind(r.y)
        .bind(r.z)
        .bind(i64::from(r.qt_valid))
        .bind(i64::from(r.hidden))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        res.positions += 1;
    }
    for c in &conn_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiJumpConnection
               (entryUuid, exitUuid, entrySystem, exitSystem, fuelCost, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&c.entry)
        .bind(&c.exit)
        .bind(&c.entry_sys)
        .bind(&c.exit_sys)
        .bind(c.fuel)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        res.connections += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(res)
}

/* ────────────────────────────  Mapping lieux  ─────────────────────────────── */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MappingResult {
    pub total: i64,
    pub matched: i64,
    pub unmatched: i64,
    pub via_alias: i64,
}

/// Construit CargoLocationMapping depuis CargoShop (leaf → slug) ↔ WikiStarmapLocation (slug).
/// Consulte CargoLocationAlias d'abord. Les non-résolus (matchType='none') sont logués.
async fn sync_mapping_core(app: &AppHandle) -> Result<MappingResult, String> {
    use std::collections::HashMap;

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // Index Wiki : slug → (uuid, name, system).
    let wiki = sqlx::query("SELECT uuid, slug, name, systemName FROM WikiStarmapLocation WHERE slug IS NOT NULL")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut by_slug: HashMap<String, (String, Option<String>, Option<String>)> = HashMap::new();
    for r in &wiki {
        let slug: String = r.try_get("slug").unwrap_or_default();
        if slug.is_empty() {
            continue;
        }
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        let name: Option<String> = r.try_get::<Option<String>, _>("name").ok().flatten();
        let system: Option<String> = r.try_get::<Option<String>, _>("systemName").ok().flatten();
        by_slug.entry(slug).or_insert((uuid, name, system));
    }

    // Alias manuels : tradeSlug → wikiSlug.
    let alias_rows = sqlx::query("SELECT tradeSlug, wikiSlug FROM CargoLocationAlias")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut alias: HashMap<String, String> = HashMap::new();
    for r in &alias_rows {
        let t: String = r.try_get("tradeSlug").unwrap_or_default();
        let w: String = r.try_get("wikiSlug").unwrap_or_default();
        if !t.is_empty() && !w.is_empty() {
            alias.insert(t, w);
        }
    }

    // Lieux Trade Tools = leaves distinctes des boutiques.
    let shops = sqlx::query("SELECT name, leaf FROM CargoShop")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    // tradeSlug → (leaf example, path example)
    let mut trade: HashMap<String, (String, String)> = HashMap::new();
    for r in &shops {
        let name: String = r.try_get("name").unwrap_or_default();
        let leaf: String = r.try_get("leaf").unwrap_or_default();
        if leaf.is_empty() {
            continue;
        }
        let slug = slugify(&leaf);
        if slug.is_empty() {
            continue;
        }
        trade.entry(slug).or_insert((leaf, name));
    }

    let mut res = MappingResult::default();
    let mut unmatched_log: Vec<String> = Vec::new();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoLocationMapping").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for (trade_slug, (leaf, path)) in &trade {
        res.total += 1;
        // alias d'abord, sinon match direct sur le slug.
        let (match_type, wiki_slug_used, via_alias) = match alias.get(trade_slug) {
            Some(target) => ("alias", target.clone(), true),
            None => ("slug", trade_slug.clone(), false),
        };
        let hit = by_slug.get(&wiki_slug_used);

        let (m_type, uuid, w_slug, w_name, w_sys) = match hit {
            Some((uuid, name, system)) => {
                res.matched += 1;
                if via_alias {
                    res.via_alias += 1;
                }
                (match_type, Some(uuid.clone()), Some(wiki_slug_used.clone()), name.clone(), system.clone())
            }
            None => {
                res.unmatched += 1;
                unmatched_log.push(format!("{trade_slug} (\"{leaf}\")"));
                ("none", None, None, None, None)
            }
        };

        sqlx::query(
            "INSERT OR REPLACE INTO CargoLocationMapping
               (tradeSlug, tradeLeaf, tradeExamplePath, wikiUuid, wikiSlug, wikiName, wikiSystem, matchType, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(trade_slug)
        .bind(leaf)
        .bind(path)
        .bind(&uuid)
        .bind(&w_slug)
        .bind(&w_name)
        .bind(&w_sys)
        .bind(m_type)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    if !unmatched_log.is_empty() {
        eprintln!(
            "[cargo_routes] mapping NON résolus ({}) — à traiter via CargoLocationAlias : {}",
            unmatched_log.len(),
            unmatched_log.join(", ")
        );
    }
    Ok(res)
}

/// Contrôle de cohérence : combien des 14 hubs d'audit sont résolus bout-en-bout
/// (slug présent en WikiStarmapLocation ET position x/y/z disponible).
async fn check_audit_hubs(app: &AppHandle) -> Result<i64, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut ok = 0i64;
    for slug in AUDIT_HUB_SLUGS {
        let row = sqlx::query(
            "SELECT 1
               FROM WikiStarmapLocation l
               JOIN WikiLocationPosition p ON p.uuid = l.uuid
              WHERE l.slug = ?
              LIMIT 1",
        )
        .bind(slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        if row.is_some() {
            ok += 1;
        } else {
            eprintln!("[cargo_routes] hub d'audit NON résolu (slug+position) : {slug}");
        }
    }
    Ok(ok)
}

/* ──────────────────────────  Commandes exposées  ──────────────────────────── */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CargoReferenceSyncReport {
    pub commodities: i64,
    pub shops: i64,
    pub ships_api: i64,
    pub wiki_locations: i64,
    pub positions: i64,
    pub jump_connections: i64,
    pub mapping_total: i64,
    pub mapping_matched: i64,
    pub mapping_unmatched: i64,
    pub mapping_via_alias: i64,
    pub positions_ok: bool,
    pub positions_error: Option<String>,
    pub audit_hubs_matched: i64,
    pub audit_hubs_total: i64,
    pub errors: Vec<String>,
}

/// Sync globale Phase A : enchaîne les sources, idempotent (re-run = upsert/refresh).
/// L'échec d'une source de PRIX/réf stoppe (donnée critique) ; l'échec des POSITIONS
/// est isolé (loggé, positions_ok=false) et n'empêche pas le reste.
#[tauri::command]
pub async fn sync_cargo_reference(app: AppHandle) -> Result<CargoReferenceSyncReport, String> {
    let mut report = CargoReferenceSyncReport::default();
    report.audit_hubs_total = AUDIT_HUB_SLUGS.len() as i64;

    let trade = trade_client()?;
    let wiki = wiki_client()?;

    // 1-3. Trade Tools (catalogues).
    report.commodities = sync_commodities_core(&app, &trade).await?;
    report.shops = sync_shops_core(&app, &trade).await?;
    report.ships_api = sync_ships_api_core(&app, &trade).await?;

    // 4. SC Wiki — lieux enrichis.
    report.wiki_locations = sync_wiki_locations_core(&app, &wiki).await?;

    // 5. SC Wiki — positions (ISOLÉ : un échec ne casse pas la sync).
    match sync_positions_core(&app, &wiki).await {
        Ok(p) => {
            report.positions = p.positions;
            report.jump_connections = p.connections;
            report.positions_ok = true;
        }
        Err(e) => {
            report.positions_ok = false;
            report.positions_error = Some(e.clone());
            report.errors.push(format!("positions: {e}"));
            eprintln!("[cargo_routes] /api/locations/positions ÉCHEC (isolé, fallback marge brute) : {e}");
        }
    }

    // 6. Mapping lieux Trade Tools → SC Wiki.
    let m = sync_mapping_core(&app).await?;
    report.mapping_total = m.total;
    report.mapping_matched = m.matched;
    report.mapping_unmatched = m.unmatched;
    report.mapping_via_alias = m.via_alias;

    // Contrôle de cohérence des 14 hubs (dépend des positions ; 0 si positions KO).
    report.audit_hubs_matched = check_audit_hubs(&app).await.unwrap_or(0);

    eprintln!(
        "[cargo_routes] SYNC RÉFÉRENCE — commodities:{} shops:{} ships:{} wikiLoc:{} positions:{} (ok:{}) jumps:{} | mapping {}/{} (alias:{}, non résolus:{}) | hubs {}/{}",
        report.commodities,
        report.shops,
        report.ships_api,
        report.wiki_locations,
        report.positions,
        report.positions_ok,
        report.jump_connections,
        report.mapping_matched,
        report.mapping_total,
        report.mapping_via_alias,
        report.mapping_unmatched,
        report.audit_hubs_matched,
        report.audit_hubs_total,
    );

    Ok(report)
}

/// Sync isolée des seules positions (appelable seule pour re-tester l'endpoint non documenté).
#[tauri::command]
pub async fn sync_cargo_positions(app: AppHandle) -> Result<PositionsSyncResult, String> {
    let wiki = wiki_client()?;
    sync_positions_core(&app, &wiki).await
}

/// Comptes par table de référence (vérification rapide post-sync, sans relancer le réseau).
#[tauri::command]
pub async fn get_cargo_reference_status(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query(&format!("SELECT COUNT(*) AS c FROM {table}"))
            .fetch_one(pool)
            .await
            .ok()
            .and_then(|r| r.try_get::<i64, _>("c").ok())
            .unwrap_or(0)
    }

    let mapping_matched = sqlx::query("SELECT COUNT(*) AS c FROM CargoLocationMapping WHERE matchType <> 'none'")
        .fetch_one(pool)
        .await
        .ok()
        .and_then(|r| r.try_get::<i64, _>("c").ok())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "commodities": count(pool, "CargoCommodity").await,
        "shops": count(pool, "CargoShop").await,
        "shipsApi": count(pool, "CargoShipApi").await,
        "wikiLocations": count(pool, "WikiStarmapLocation").await,
        "positions": count(pool, "WikiLocationPosition").await,
        "jumpConnections": count(pool, "WikiJumpConnection").await,
        "mappingTotal": count(pool, "CargoLocationMapping").await,
        "mappingMatched": mapping_matched,
        "aliases": count(pool, "CargoLocationAlias").await,
    }))
}

/* ════════════ Phase C' (1/2) — MOTEUR de calcul profit/temps (backend) ═══════════ */
// Routes A→B simples (maxStops=1) : achat (boutique SELLS) → revente (boutique BUYS).
// Socle = marge brute (toujours calculable). Couche distance/temps PAR-DESSUS, ISOLÉE :
// si une position manque, la route reste (profitPerMinute=null), jamais de crash.
//
// MODÈLE DE TEMPS RÉALISTE (proche de SC Wiki routePlanner.js) :
//   timeSec = HANDLING_FORFAIT + Σ_legs( spool + tempsTrajetRampe(distance) )
//   • tempsTrajetRampe = rampe d'accélération a1→a2 → vmax → décélération (portage exact
//     de estimateTravelTime ; calibré sur travel_time_10gm). Repli vmax-only si a1/a2
//     absents, puis tt10-linéaire, sinon pas de temps (marge brute).
//   • Plus de plancher arbitraire : le forfait chargement/déchargement joue ce rôle.
//   • Stats QT = drive QUANTUM STOCK du vaisseau (ShipHardpoint→Component).
// HYPOTHÈSE QUANTITÉ : `quantity` <= 0 (ou NULL) du flux de prix = « non renseigné » →
//   PAS de contrainte de stock. Seules les quantités strictement positives bornent.
// CARBURANT : laissé à plus tard (fuel=null).

/* ── Constantes ajustables : filtres qualité + modèle de temps + fraîcheur ── */

/// (1) Cap de ratio de marge : rejette une route si sellPrice/buyPrice dépasse ce facteur.
/// Resserré à 5× (audit : aucune marge légitime observée > ~4×, 5× garde une marge de
/// sécurité ; au-delà = scan aberrant).
const MAX_MARGIN_RATIO: f64 = 5.0;

/// (2) Bande de prix autour de la MÉDIANE par marchandise : écarte > FACTEUR×médiane ou
/// < médiane/FACTEUR. 5× garde la variabilité légitime, coupe les scans absurdes.
const MEDIAN_BAND_FACTOR: f64 = 5.0;

/// (3) Forfait chargement/déchargement (secondes), fixe par route : modélise le temps de
/// freight elevator / QCS aux deux extrémités. Remplace l'ancien plancher 2 min.
/// Valeur plausible et AJUSTABLE (à calibrer sur des temps SC Trade Tools observés).
const HANDLING_FORFAIT_SEC: f64 = 120.0;

/// (4) Cap de FRAÎCHEUR : on écarte les lignes de prix plus vieilles que N jours
/// (le flux crowdsource peut contenir des scans d'il y a plusieurs semaines).
const MAX_PRICE_AGE_DAYS: i64 = 14;

/// (5) Seuil de distance fiable (mètres) = 0,01 Gm. Sous ce seuil, entre deux lieux de
/// NOMS DIFFÉRENTS, la position fine manque (avant-postes ~collés retombant sur ~la même
/// position) → distance NON fiable → traitée comme INCONNUE (pas de temps/profit-min,
/// affichée "—", route conservée en marge brute). UEX lui-même affiche N/A pour ces cas.
const EPSILON_DISTANCE_M: f64 = 1.0e7;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoRoute {
    pub commodity: String,
    pub from_location: String,
    pub to_location: String,
    pub from_name: Option<String>,
    pub to_name: Option<String>,
    pub from_uuid: Option<String>,
    pub to_uuid: Option<String>,
    pub buy_price: f64,
    pub sell_price: f64,
    pub margin_unit: f64,
    pub quantity_scu: i64,
    pub profit: f64,
    pub from_system: Option<String>,
    pub to_system: Option<String>,
    pub jumps: Option<i64>,
    pub distance_gm: Option<f64>,
    pub time_minutes: Option<f64>,
    pub profit_per_minute: Option<f64>,
    pub price_timestamp: Option<String>,
    pub fuel: Option<f64>,
    /// Carburant quantique consommé par ce leg (SCU) = distanceGm × conso drive (SCU/Gm).
    /// None si l'autonomie n'est pas synchronisée pour ce vaisseau.
    pub fuel_scu: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRoutesResult {
    pub ship_name: String,
    pub cargo_scu: Option<i64>,
    pub qt_drive_speed: Option<f64>,
    pub qt_spool_time: Option<f64>,
    pub qt_resolved: bool,
    pub qt_ramp: bool,
    pub investment: f64,
    pub routes_considered: i64,
    pub routes_with_time: i64,
    pub price_points_dropped_band: i64,
    pub price_points_dropped_stale: i64,
    pub pairs_dropped_ratio: i64,
    pub routes: Vec<CargoRoute>,
    pub note: String,
}

#[derive(Clone)]
pub(crate) struct Pos {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub system: Option<String>,
}

#[derive(Clone)]
struct PricePoint {
    location: String,
    slug: Option<String>,
    price: f64,
    quantity: Option<i64>,
    timestamp: Option<String>,
    /// Stock COURANT brut (scuBuy pour l'achat / scuSellStock pour la vente). Sert au flag
    /// rupture (=0) et à l'affluence estimée. NON replié sur la moyenne (≠ `quantity`).
    stock_cur: Option<i64>,
    /// Stock MOYEN historique (scuBuyAvg / scuSellStockAvg) — référence de l'affluence.
    stock_avg: Option<i64>,
    /// Statut d'inventaire UEX (0–7 ; 0/1 = épuisé/très bas).
    status: Option<i64>,
}

pub(crate) fn euclid(a: &Pos, b: &Pos) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Distance achat→vente en mètres + nb de legs quantiques.
///   • même système → euclidien direct (1 leg).
///   • systèmes différents → enchaînement via les jump points (BFS sur le graphe de
///     systèmes). None si une position de porte manque → route en marge brute (sans temps).
pub(crate) fn route_distance(
    buy_uuid: &str,
    sell_uuid: &str,
    pos: &std::collections::HashMap<String, Pos>,
    graph: &std::collections::HashMap<String, Vec<(String, String, String)>>,
) -> Option<(f64, i64)> {
    let bp = pos.get(buy_uuid)?;
    let sp = pos.get(sell_uuid)?;
    let (Some(bs), Some(ss)) = (bp.system.clone(), sp.system.clone()) else {
        if buy_uuid == sell_uuid {
            return Some((0.0, 1));
        }
        return None;
    };
    if bs == ss {
        return Some((euclid(bp, sp), 1));
    }

    use std::collections::{HashMap, VecDeque};
    let mut prev: HashMap<String, (String, String, String)> = HashMap::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut q: VecDeque<String> = VecDeque::new();
    seen.insert(bs.clone());
    q.push_back(bs.clone());
    let mut found = false;
    while let Some(cur) = q.pop_front() {
        if cur == ss {
            found = true;
            break;
        }
        if let Some(neis) = graph.get(&cur) {
            for (nsys, entry, exit) in neis {
                if seen.insert(nsys.clone()) {
                    prev.insert(nsys.clone(), (cur.clone(), entry.clone(), exit.clone()));
                    q.push_back(nsys.clone());
                }
            }
        }
    }
    if !found {
        return None;
    }
    let mut hops: Vec<(String, String)> = Vec::new();
    let mut cur = ss.clone();
    while cur != bs {
        let (from_sys, entry, exit) = prev.get(&cur)?.clone();
        hops.push((entry, exit));
        cur = from_sys;
    }
    hops.reverse();

    let mut total = 0.0;
    let mut legs = 0i64;
    let mut cur_pos = bp.clone();
    for (entry, exit) in &hops {
        let ep = pos.get(entry)?;
        let xp = pos.get(exit)?;
        total += euclid(&cur_pos, ep);
        legs += 1;
        cur_pos = xp.clone();
    }
    total += euclid(&cur_pos, sp);
    legs += 1;
    Some((total, legs))
}

/* ── Modèle de temps QT : fonctions pures extraites dans commands::travel_physics ── */
use crate::commands::travel_physics::qt_travel_seconds;

/// Marché chargé en mémoire (étapes 1-4 du moteur) : partagé entre le single-hop et le
/// planificateur de boucle. Owned → le verrou DB est relâché après chargement.
struct Market {
    cargo_scu: Option<i64>,
    qt_speed: Option<f64>,
    qt_spool: Option<f64>,
    qt_a1: Option<f64>,
    qt_a2: Option<f64>,
    qt_tt10: Option<f64>,
    qt_resolved: bool,
    qt_ramp: bool,
    spool: f64,
    /// Conso du drive quantique stock en SCU/Gm (coût carburant par leg). None si non synchro.
    qt_fuel_per_gm: Option<f64>,
    /// Capacité du réservoir de carburant quantique (SCU). None si non synchro.
    quantum_fuel_scu: Option<f64>,
    /// Autonomie max du vaisseau en Gm (pré-calculée par l'API Wiki). None si non synchro.
    quantum_range_gm: Option<f64>,
    buy_points: std::collections::HashMap<String, Vec<PricePoint>>,
    sell_points: std::collections::HashMap<String, Vec<PricePoint>>,
    pos: std::collections::HashMap<String, Pos>,
    graph: std::collections::HashMap<String, Vec<(String, String, String)>>,
    slug_uuid: std::collections::HashMap<String, String>,
    slug_name: std::collections::HashMap<String, String>,
    price_points_dropped_band: i64,
    price_points_dropped_stale: i64,
}

/// Charge le marché (vaisseau + prix filtrés + positions + sauts). Lecture 100 % base.
async fn load_market(app: &AppHandle, ship_name: &str) -> Result<Market, String> {
    use std::collections::HashMap;

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // Vaisseau : capacité SCU + drive quantique stock (best-effort).
    let ship_row = sqlx::query(
        "SELECT id, cargoScu, quantumFuel, quantumRange FROM ShipData
          WHERE name = ? COLLATE NOCASE OR nameLocalized = ? COLLATE NOCASE
          LIMIT 1",
    )
    .bind(ship_name)
    .bind(ship_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (ship_data_id, cargo_scu, quantum_fuel_scu, quantum_range_gm): (
        Option<i64>,
        Option<i64>,
        Option<f64>,
        Option<f64>,
    ) = match ship_row {
        Some(r) => (
            r.try_get::<i64, _>("id").ok(),
            r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
            r.try_get::<Option<f64>, _>("quantumFuel").ok().flatten(),
            r.try_get::<Option<f64>, _>("quantumRange").ok().flatten(),
        ),
        None => (None, None, None, None),
    };

    let mut qt_speed: Option<f64> = None;
    let mut qt_spool: Option<f64> = None;
    let mut qt_a1: Option<f64> = None;
    let mut qt_a2: Option<f64> = None;
    let mut qt_tt10: Option<f64> = None;
    let mut qt_fuel_per_gm: Option<f64> = None;
    if let Some(sid) = ship_data_id {
        if let Some(r) = sqlx::query(
            "SELECT c.qtDriveSpeed, c.qtSpoolTime, c.qtAccelStageOne, c.qtAccelStageTwo, c.qtTravelTime10gm, c.qtFuelPerGm
               FROM ShipHardpoint h
               JOIN Component c ON c.className = h.defaultComponentClassName
              WHERE h.shipId = ? AND h.type = 'QUANTUM_DRIVE' AND c.qtDriveSpeed IS NOT NULL
              ORDER BY c.qtDriveSpeed DESC
              LIMIT 1",
        )
        .bind(sid)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        {
            qt_speed = r.try_get::<Option<f64>, _>("qtDriveSpeed").ok().flatten();
            qt_spool = r.try_get::<Option<f64>, _>("qtSpoolTime").ok().flatten();
            qt_a1 = r.try_get::<Option<f64>, _>("qtAccelStageOne").ok().flatten();
            qt_a2 = r.try_get::<Option<f64>, _>("qtAccelStageTwo").ok().flatten();
            qt_tt10 = r.try_get::<Option<f64>, _>("qtTravelTime10gm").ok().flatten();
            qt_fuel_per_gm = r.try_get::<Option<f64>, _>("qtFuelPerGm").ok().flatten();
        }
    }
    let qt_resolved = qt_speed.map(|s| s > 0.0).unwrap_or(false);
    let qt_ramp = qt_a1.map(|x| x > 0.0).unwrap_or(false) && qt_a2.map(|x| x > 0.0).unwrap_or(false);
    let spool = qt_spool.unwrap_or(0.0);

    // Terminaux : clé de lieu (wikiSlug partagée → dédup + position ; sinon "uex-{id}").
    let mut slug_uuid: HashMap<String, String> = HashMap::new();
    let mut slug_name: HashMap<String, String> = HashMap::new();
    let mut term_key: HashMap<i64, String> = HashMap::new();
    for r in sqlx::query("SELECT id, displayName, wikiUuid, wikiSlug FROM UexTerminal")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        let id: i64 = r.try_get("id").unwrap_or_default();
        let display: String = r.try_get::<Option<String>, _>("displayName").ok().flatten().unwrap_or_default();
        let wuuid: Option<String> = r.try_get::<Option<String>, _>("wikiUuid").ok().flatten();
        let wslug: Option<String> = r.try_get::<Option<String>, _>("wikiSlug").ok().flatten();
        let key = wslug.filter(|s| !s.is_empty()).unwrap_or_else(|| format!("uex-{id}"));
        if let Some(u) = wuuid {
            if !u.is_empty() {
                slug_uuid.entry(key.clone()).or_insert(u);
            }
        }
        if !display.is_empty() {
            slug_name.entry(key.clone()).or_insert(display);
        }
        term_key.insert(id, key);
    }

    // Prix UEX → buy_points (achat) / sell_points (vente). Filtre (4) FRAÎCHEUR.
    let price_rows = sqlx::query(&format!(
        "SELECT commodityName, idTerminal, priceBuy, scuBuy, scuBuyAvg, priceSell,
                scuSellStock, scuSellStockAvg, statusBuy, statusSell, timestampIso,
                (timestampIso IS NOT NULL AND julianday('now') - julianday(timestampIso) > {MAX_PRICE_AGE_DAYS}) AS stale
           FROM UexCommodityPrice",
    ))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut buy_points: HashMap<String, Vec<PricePoint>> = HashMap::new();
    let mut sell_points: HashMap<String, Vec<PricePoint>> = HashMap::new();
    let mut price_points_dropped_stale = 0i64;
    let eff = |cur: Option<f64>, avg: Option<f64>| -> Option<i64> {
        let v = cur.filter(|x| *x > 0.0).or_else(|| avg.filter(|x| *x > 0.0))?;
        Some(v.round() as i64)
    };
    for r in &price_rows {
        let commodity: String = r.try_get("commodityName").unwrap_or_default();
        if commodity.is_empty() {
            continue;
        }
        let id_term: i64 = r.try_get("idTerminal").unwrap_or_default();
        let Some(key) = term_key.get(&id_term) else { continue };
        let buy = r.try_get::<Option<f64>, _>("priceBuy").ok().flatten().unwrap_or(0.0);
        let sell = r.try_get::<Option<f64>, _>("priceSell").ok().flatten().unwrap_or(0.0);
        if buy <= 0.0 && sell <= 0.0 {
            continue;
        }
        if r.try_get::<i64, _>("stale").unwrap_or(0) != 0 {
            price_points_dropped_stale += 1;
            continue;
        }
        let ts: Option<String> = r.try_get::<Option<String>, _>("timestampIso").ok().flatten();
        let display = slug_name.get(key).cloned().unwrap_or_default();
        // Stock brut (non replié sur la moyenne) : f64 en base → i64 arrondi.
        let raw_i64 = |k: &str| -> Option<i64> {
            r.try_get::<Option<f64>, _>(k).ok().flatten().map(|x| x.round() as i64)
        };
        if buy > 0.0 {
            buy_points.entry(commodity.clone()).or_default().push(PricePoint {
                location: display.clone(),
                slug: Some(key.clone()),
                price: buy,
                quantity: eff(
                    r.try_get::<Option<f64>, _>("scuBuy").ok().flatten(),
                    r.try_get::<Option<f64>, _>("scuBuyAvg").ok().flatten(),
                ),
                timestamp: ts.clone(),
                stock_cur: raw_i64("scuBuy"),
                stock_avg: raw_i64("scuBuyAvg"),
                status: r.try_get::<Option<i64>, _>("statusBuy").ok().flatten(),
            });
        }
        if sell > 0.0 {
            sell_points.entry(commodity.clone()).or_default().push(PricePoint {
                location: display,
                slug: Some(key.clone()),
                price: sell,
                quantity: eff(
                    r.try_get::<Option<f64>, _>("scuSellStock").ok().flatten(),
                    r.try_get::<Option<f64>, _>("scuSellStockAvg").ok().flatten(),
                ),
                timestamp: ts,
                stock_cur: raw_i64("scuSellStock"),
                stock_avg: raw_i64("scuSellStockAvg"),
                status: r.try_get::<Option<i64>, _>("statusSell").ok().flatten(),
            });
        }
    }

    // Filtre (2) : bande de prix autour de la MÉDIANE par marchandise.
    let mut medians: HashMap<String, f64> = HashMap::new();
    {
        let mut acc: HashMap<String, Vec<f64>> = HashMap::new();
        for (c, v) in buy_points.iter().chain(sell_points.iter()) {
            let e = acc.entry(c.clone()).or_default();
            for p in v {
                e.push(p.price);
            }
        }
        for (c, mut v) in acc {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let m = v[v.len() / 2];
            if m > 0.0 {
                medians.insert(c, m);
            }
        }
    }
    let mut price_points_dropped_band = 0i64;
    {
        let med = &medians;
        let mut prune = |map: &mut HashMap<String, Vec<PricePoint>>| {
            for (c, v) in map.iter_mut() {
                if let Some(&m) = med.get(c) {
                    let before = v.len();
                    v.retain(|p| p.price <= m * MEDIAN_BAND_FACTOR && p.price >= m / MEDIAN_BAND_FACTOR);
                    price_points_dropped_band += (before - v.len()) as i64;
                }
            }
        };
        prune(&mut buy_points);
        prune(&mut sell_points);
    }

    let mut pos: HashMap<String, Pos> = HashMap::new();
    for r in sqlx::query("SELECT uuid, x, y, z, systemName FROM WikiLocationPosition")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        let (Some(x), Some(y), Some(z)) = (
            r.try_get::<Option<f64>, _>("x").ok().flatten(),
            r.try_get::<Option<f64>, _>("y").ok().flatten(),
            r.try_get::<Option<f64>, _>("z").ok().flatten(),
        ) else {
            continue;
        };
        pos.insert(uuid, Pos { x, y, z, system: r.try_get::<Option<String>, _>("systemName").ok().flatten() });
    }

    let mut graph: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    for r in sqlx::query("SELECT entryUuid, exitUuid, entrySystem, exitSystem FROM WikiJumpConnection")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        let eu: String = r.try_get("entryUuid").unwrap_or_default();
        let xu: String = r.try_get("exitUuid").unwrap_or_default();
        let es: Option<String> = r.try_get::<Option<String>, _>("entrySystem").ok().flatten();
        let xs: Option<String> = r.try_get::<Option<String>, _>("exitSystem").ok().flatten();
        if let (Some(es), Some(xs)) = (es, xs) {
            graph.entry(es.clone()).or_default().push((xs.clone(), eu.clone(), xu.clone()));
            graph.entry(xs).or_default().push((es, xu, eu));
        }
    }

    Ok(Market {
        cargo_scu,
        qt_speed,
        qt_spool,
        qt_a1,
        qt_a2,
        qt_tt10,
        qt_resolved,
        qt_ramp,
        spool,
        qt_fuel_per_gm,
        quantum_fuel_scu,
        quantum_range_gm,
        buy_points,
        sell_points,
        pos,
        graph,
        slug_uuid,
        slug_name,
        price_points_dropped_band,
        price_points_dropped_stale,
    })
}

/// Cœur du moteur : lit tout en mémoire (sous le verrou DB), puis calcule à froid.
async fn find_cargo_routes_core(
    app: &AppHandle,
    ship_name: String,
    investment: f64,
    system: Option<String>,
    limit: i64,
) -> Result<FindRoutesResult, String> {
    let Market {
        cargo_scu,
        qt_speed,
        qt_spool,
        qt_a1,
        qt_a2,
        qt_tt10,
        qt_resolved,
        qt_ramp,
        spool,
        qt_fuel_per_gm,
        quantum_fuel_scu: _,
        quantum_range_gm: _,
        buy_points,
        sell_points,
        pos,
        graph,
        slug_uuid,
        slug_name,
        price_points_dropped_band,
        price_points_dropped_stale,
    } = load_market(app, &ship_name).await?;

    let resolve_pos = |slug: &Option<String>| -> Option<(String, Pos)> {
        let s = slug.as_ref()?;
        let uuid = slug_uuid.get(s)?;
        let p = pos.get(uuid)?;
        Some((uuid.clone(), p.clone()))
    };

    let readable = |slug: &Option<String>, raw: &str| -> Option<String> {
        slug.as_ref()
            .and_then(|s| slug_name.get(s))
            .cloned()
            .or_else(|| Some(leaf_of(raw)))
    };

    // Génération des routes.
    let mut routes: Vec<CargoRoute> = Vec::new();
    let mut pairs_dropped_ratio = 0i64;
    let sys_filter = system.as_ref().map(|s| s.trim().to_lowercase());

    for (commodity, buys) in &buy_points {
        let Some(sells) = sell_points.get(commodity) else { continue };
        for bp in buys {
            if bp.price <= 0.0 {
                continue;
            }
            let by_budget = (investment / bp.price).floor() as i64;
            if by_budget < 1 {
                continue;
            }
            for sp in sells {
                if sp.price <= bp.price {
                    continue;
                }
                // Une route doit DÉPLACER la marchandise : exclure achat==vente au même lieu
                // (même slug si résolu, sinon même chaîne location) — sinon « routes » à
                // distance 0 qui faussent le profit/temps.
                let same_place = match (&bp.slug, &sp.slug) {
                    (Some(a), Some(b)) => a == b,
                    _ => bp.location == sp.location,
                };
                if same_place {
                    continue;
                }
                // Filtre (1) : cap de ratio de marge (rejette les paires aberrantes).
                if sp.price / bp.price > MAX_MARGIN_RATIO {
                    pairs_dropped_ratio += 1;
                    continue;
                }
                let margin = sp.price - bp.price;
                let mut qty = by_budget;
                if let Some(c) = cargo_scu {
                    if c > 0 {
                        qty = qty.min(c);
                    }
                }
                if let Some(q) = bp.quantity {
                    if q > 0 {
                        qty = qty.min(q);
                    }
                }
                if let Some(q) = sp.quantity {
                    if q > 0 {
                        qty = qty.min(q);
                    }
                }
                if qty < 1 {
                    continue;
                }
                let profit = margin * qty as f64;

                let from_res = resolve_pos(&bp.slug);
                let to_res = resolve_pos(&sp.slug);
                let from_system = from_res.as_ref().and_then(|(_, p)| p.system.clone());
                let to_system = to_res.as_ref().and_then(|(_, p)| p.system.clone());

                if let Some(f) = &sys_filter {
                    let ok = from_system.as_ref().map(|s| s.to_lowercase() == *f).unwrap_or(false);
                    if !ok {
                        continue;
                    }
                }

                let mut distance_gm = None;
                let mut time_minutes = None;
                let mut profit_per_minute = None;
                let mut jumps = None;
                if let (Some((bu, _)), Some((su, _))) = (&from_res, &to_res) {
                    if let Some((dist_m, legs)) = route_distance(bu, su, &pos, &graph) {
                        // Distance fiable uniquement au-dessus du seuil epsilon. En dessous
                        // (deux lieux distincts ~collés = position fine manquante), on traite
                        // comme DISTANCE INCONNUE : pas de distance/temps/profit-min (route
                        // conservée, triée par profit brut comme le fallback).
                        if dist_m >= EPSILON_DISTANCE_M {
                            distance_gm = Some(dist_m / 1.0e9);
                            jumps = Some(legs - 1);
                            if qt_resolved {
                                // Temps RÉALISTE : forfait chargement + spool×legs + rampe accel.
                                if let Some(travel) = qt_travel_seconds(dist_m, qt_speed, qt_a1, qt_a2, qt_tt10) {
                                    let time_sec = HANDLING_FORFAIT_SEC + spool * legs as f64 + travel;
                                    let tm = time_sec / 60.0;
                                    time_minutes = Some(tm);
                                    if tm > 0.0 {
                                        profit_per_minute = Some(profit / tm);
                                    }
                                }
                            }
                        }
                    }
                }

                // Fraîcheur de la route = la plus VIEILLE des deux lignes de prix (limitante).
                let price_timestamp = match (&bp.timestamp, &sp.timestamp) {
                    (Some(a), Some(b)) => Some(a.min(b).clone()),
                    (Some(a), None) => Some(a.clone()),
                    (None, Some(b)) => Some(b.clone()),
                    (None, None) => None,
                };

                routes.push(CargoRoute {
                    commodity: commodity.clone(),
                    from_location: bp.location.clone(),
                    to_location: sp.location.clone(),
                    from_name: readable(&bp.slug, &bp.location),
                    to_name: readable(&sp.slug, &sp.location),
                    from_uuid: bp.slug.as_ref().and_then(|s| slug_uuid.get(s)).cloned(),
                    to_uuid: sp.slug.as_ref().and_then(|s| slug_uuid.get(s)).cloned(),
                    buy_price: bp.price,
                    sell_price: sp.price,
                    margin_unit: margin,
                    quantity_scu: qty,
                    profit,
                    from_system,
                    to_system,
                    jumps,
                    distance_gm,
                    time_minutes,
                    profit_per_minute,
                    price_timestamp,
                    fuel: None,
                    fuel_scu: distance_gm.zip(qt_fuel_per_gm).map(|(d, f)| d * f),
                });
            }
        }
    }

    let routes_considered = routes.len() as i64;
    let routes_with_time = routes.iter().filter(|r| r.profit_per_minute.is_some()).count() as i64;

    // Tri : profit/min décroissant (routes chronométrées en tête), sinon profit brut.
    routes.sort_by(|a, b| match (a.profit_per_minute, b.profit_per_minute) {
        (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.profit.partial_cmp(&a.profit).unwrap_or(std::cmp::Ordering::Equal),
    });
    if routes.len() > limit as usize {
        routes.truncate(limit as usize);
    }

    let note = format!(
        "Temps = forfait {}s + spool×legs + {}. Quantité bornée par budget{}, stock>0. \
         Fraîcheur ≤ {} j. Carburant différé.{}{}",
        HANDLING_FORFAIT_SEC as i64,
        if qt_ramp { "rampe accel (a1/a2)" } else { "vitesse max (a1/a2 non synchronisés → re-sync composants)" },
        if cargo_scu.is_some() { " + cargoScu" } else { " (cargoScu inconnu → non borné)" },
        MAX_PRICE_AGE_DAYS,
        if qt_resolved { "" } else { " Drive QT non résolu → profit/min indisponible (marge brute)." },
        if pos.is_empty() { " Table positions vide → marge brute pure." } else { "" },
    );

    eprintln!(
        "[cargo_routes] ROUTES {} (budget {:.0}) — {} routes ({} avec temps, rampe={}) | filtres: bande -{}, périmé -{}, ratio>{}× -{}",
        ship_name,
        investment,
        routes_considered,
        routes_with_time,
        qt_ramp,
        price_points_dropped_band,
        price_points_dropped_stale,
        MAX_MARGIN_RATIO,
        pairs_dropped_ratio,
    );

    Ok(FindRoutesResult {
        ship_name,
        cargo_scu,
        qt_drive_speed: qt_speed,
        qt_spool_time: qt_spool,
        qt_resolved,
        qt_ramp,
        investment,
        routes_considered,
        routes_with_time,
        price_points_dropped_band,
        price_points_dropped_stale,
        pairs_dropped_ratio,
        routes,
        note,
    })
}

/* ════════════ Phase C' (2/2) — Planificateur de BOUCLE (chaînage glouton/beam) ════ */

/// Un « leg » statique (indépendant du budget) : acheter `commodity` au lieu `from` →
/// revendre au lieu `to`. Plafonds (cargo/stock/demande) et temps fixes ; la quantité
/// réelle dépend du budget courant, appliqué au moment du chaînage.
#[derive(Clone)]
struct LegStatic {
    commodity: String,
    from_key: String,
    to_key: String,
    from_location: String,
    to_location: String,
    from_name: Option<String>,
    to_name: Option<String>,
    from_uuid: Option<String>,
    to_uuid: Option<String>,
    from_system: Option<String>,
    to_system: Option<String>,
    buy_price: f64,
    sell_price: f64,
    margin_unit: f64,
    cargo_cap: i64, // min(cargoScu, stockAchat, demandeVente) ; i64::MAX si aucun plafond
    jumps: Option<i64>,
    distance_gm: Option<f64>,
    time_minutes: Option<f64>,
    /// Carburant quantique du leg (SCU) = distanceGm × conso drive (SCU/Gm). None si non synchro.
    fuel_scu: Option<f64>,
    price_timestamp: Option<String>,
    /// Affluence ESTIMÉE au point de vente : "low" | "medium" | "high" (proxy, pas un
    /// trafic réel — voir `affluence_level`).
    affluence: String,
}

/// AFFLUENCE ESTIMÉE (proxy HONNÊTE, PAS une mesure de trafic réel) au point de VENTE :
/// principalement le DÉFICIT de stock courant vs moyenne (demande déjà absorbée par
/// d'autres joueurs ⇒ route fréquentée), complété par le statut d'inventaire UEX.
/// Aucune API ne mesure la fréquentation directement → à présenter comme « estimée ».
fn affluence_level(p: &PricePoint) -> String {
    let mut score = 0i32;
    if let (Some(cur), Some(avg)) = (p.stock_cur, p.stock_avg) {
        if avg > 0 {
            let ratio = cur as f64 / avg as f64;
            if ratio < 0.34 {
                score += 2; // stock très en dessous de la moyenne = forte pression
            } else if ratio < 0.67 {
                score += 1;
            }
        }
    }
    if let Some(s) = p.status {
        if s <= 1 {
            score += 1; // inventaire épuisé/très bas = activité récente
        }
    }
    match score {
        s if s >= 2 => "high".to_string(),
        1 => "medium".to_string(),
        _ => "low".to_string(),
    }
}

/// Potentiel statique (profit/min à pleine cargaison) — heuristique de pré-tri du beam.
fn leg_potential(l: &LegStatic) -> f64 {
    let cap = if l.cargo_cap == i64::MAX { 1000 } else { l.cargo_cap } as f64;
    let p = l.margin_unit * cap;
    match l.time_minutes {
        Some(t) if t > 0.0 => p / t,
        _ => p,
    }
}

/// Quantité achetable pour un budget : min(⌊budget/prix⌋, plafond statique).
fn qty_for(l: &LegStatic, budget: f64) -> i64 {
    if l.buy_price <= 0.0 {
        return 0;
    }
    let by_budget = (budget / l.buy_price).floor() as i64;
    if l.cargo_cap == i64::MAX {
        by_budget.max(0)
    } else {
        by_budget.min(l.cargo_cap).max(0)
    }
}

/// Matérialise un leg en CargoRoute (MÊME struct que le single-hop → modale + soute
/// compatibles) pour une quantité donnée.
fn leg_to_route(l: &LegStatic, qty: i64) -> CargoRoute {
    let profit = l.margin_unit * qty as f64;
    let profit_per_minute = match l.time_minutes {
        Some(t) if t > 0.0 => Some(profit / t),
        _ => None,
    };
    CargoRoute {
        commodity: l.commodity.clone(),
        from_location: l.from_location.clone(),
        to_location: l.to_location.clone(),
        from_name: l.from_name.clone(),
        to_name: l.to_name.clone(),
        from_uuid: l.from_uuid.clone(),
        to_uuid: l.to_uuid.clone(),
        buy_price: l.buy_price,
        sell_price: l.sell_price,
        margin_unit: l.margin_unit,
        quantity_scu: qty,
        profit,
        from_system: l.from_system.clone(),
        to_system: l.to_system.clone(),
        jumps: l.jumps,
        distance_gm: l.distance_gm,
        time_minutes: l.time_minutes,
        profit_per_minute,
        price_timestamp: l.price_timestamp.clone(),
        fuel: None,
        fuel_scu: l.fuel_scu,
    }
}

/// Index des legs rentables par lieu d'ACHAT. Mêmes filtres que le single-hop (même lieu
/// exclu, ratio de marge), mais SANS bornage par l'investment (plafonds statiques).
fn build_legs(m: &Market, system_filter: Option<&str>) -> std::collections::HashMap<String, Vec<LegStatic>> {
    use std::collections::HashMap;
    let resolve_pos = |slug: &Option<String>| -> Option<(String, Pos)> {
        let s = slug.as_ref()?;
        let uuid = m.slug_uuid.get(s)?;
        let p = m.pos.get(uuid)?;
        Some((uuid.clone(), p.clone()))
    };
    let readable = |slug: &Option<String>, raw: &str| -> Option<String> {
        slug.as_ref()
            .and_then(|s| m.slug_name.get(s))
            .cloned()
            .or_else(|| Some(leaf_of(raw)))
    };

    let mut legs_from: HashMap<String, Vec<LegStatic>> = HashMap::new();
    for (commodity, buys) in &m.buy_points {
        let Some(sells) = m.sell_points.get(commodity) else { continue };
        for bp in buys {
            if bp.price <= 0.0 {
                continue;
            }
            for sp in sells {
                if sp.price <= bp.price {
                    continue;
                }
                let same_place = match (&bp.slug, &sp.slug) {
                    (Some(a), Some(b)) => a == b,
                    _ => bp.location == sp.location,
                };
                if same_place {
                    continue;
                }
                if sp.price / bp.price > MAX_MARGIN_RATIO {
                    continue;
                }
                let margin = sp.price - bp.price;
                let mut cap = i64::MAX;
                if let Some(c) = m.cargo_scu {
                    if c > 0 {
                        cap = cap.min(c);
                    }
                }
                if let Some(q) = bp.quantity {
                    if q > 0 {
                        cap = cap.min(q);
                    }
                }
                if let Some(q) = sp.quantity {
                    if q > 0 {
                        cap = cap.min(q);
                    }
                }
                if cap < 1 {
                    continue;
                }

                let from_res = resolve_pos(&bp.slug);
                let to_res = resolve_pos(&sp.slug);
                let from_system = from_res.as_ref().and_then(|(_, p)| p.system.clone());
                let to_system = to_res.as_ref().and_then(|(_, p)| p.system.clone());
                // Filtre système : confine la boucle au système choisi (legs partant de ce
                // système). Un leg sans système connu est écarté quand un filtre est actif.
                if let Some(f) = system_filter {
                    let ok = from_system.as_ref().map(|s| s.eq_ignore_ascii_case(f)).unwrap_or(false);
                    if !ok {
                        continue;
                    }
                }
                let mut distance_gm = None;
                let mut time_minutes = None;
                let mut jumps = None;
                if let (Some((bu, _)), Some((su, _))) = (&from_res, &to_res) {
                    if let Some((dist_m, legs)) = route_distance(bu, su, &m.pos, &m.graph) {
                        if dist_m >= EPSILON_DISTANCE_M {
                            distance_gm = Some(dist_m / 1.0e9);
                            jumps = Some(legs - 1);
                            if m.qt_resolved {
                                if let Some(travel) =
                                    qt_travel_seconds(dist_m, m.qt_speed, m.qt_a1, m.qt_a2, m.qt_tt10)
                                {
                                    let time_sec = HANDLING_FORFAIT_SEC + m.spool * legs as f64 + travel;
                                    time_minutes = Some(time_sec / 60.0);
                                }
                            }
                        }
                    }
                }
                let price_timestamp = match (&bp.timestamp, &sp.timestamp) {
                    (Some(a), Some(b)) => Some(a.min(b).clone()),
                    (Some(a), None) => Some(a.clone()),
                    (None, Some(b)) => Some(b.clone()),
                    (None, None) => None,
                };
                let from_key = bp.slug.clone().unwrap_or_else(|| bp.location.clone());
                let to_key = sp.slug.clone().unwrap_or_else(|| sp.location.clone());
                let leg = LegStatic {
                    commodity: commodity.clone(),
                    from_key: from_key.clone(),
                    to_key,
                    from_location: bp.location.clone(),
                    to_location: sp.location.clone(),
                    from_name: readable(&bp.slug, &bp.location),
                    to_name: readable(&sp.slug, &sp.location),
                    from_uuid: bp.slug.as_ref().and_then(|s| m.slug_uuid.get(s)).cloned(),
                    to_uuid: sp.slug.as_ref().and_then(|s| m.slug_uuid.get(s)).cloned(),
                    from_system,
                    to_system,
                    buy_price: bp.price,
                    sell_price: sp.price,
                    margin_unit: margin,
                    cargo_cap: cap,
                    jumps,
                    distance_gm,
                    time_minutes,
                    fuel_scu: distance_gm.zip(m.qt_fuel_per_gm).map(|(d, f)| d * f),
                    price_timestamp,
                    affluence: affluence_level(sp),
                };
                legs_from.entry(from_key).or_default().push(leg);
            }
        }
    }
    for v in legs_from.values_mut() {
        v.sort_by(|a, b| leg_potential(b).partial_cmp(&leg_potential(a)).unwrap_or(std::cmp::Ordering::Equal));
    }
    legs_from
}

/// Résultat d'une boucle/chaîne (legs = CargoRoute → réutilise modale détails + soute).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopResult {
    pub legs: Vec<CargoRoute>,
    pub total_profit: f64,
    pub total_time_minutes: Option<f64>,
    pub hops: i64,
    pub closed: bool,
    pub start_location: String,
    pub end_location: String,
    pub note: Option<String>,
}

/// Chaîne en construction (interne au beam).
#[derive(Clone)]
struct Chain {
    legs: Vec<LegStatic>,
    qtys: Vec<i64>,
    used: std::collections::HashSet<(String, String, String)>,
    budget: f64,
    total_profit: f64,
    total_time: f64,
    all_timed: bool,
    start_key: String,
    start_name: String,
    cur_key: String,
    cur_name: String,
}

/// Classement d'une chaîne : (chronométrée d'abord, puis valeur décroissante). Valeur =
/// profit total / temps total si toute la chaîne est chronométrée, sinon profit total.
fn chain_key(c: &Chain) -> (i32, f64) {
    if c.all_timed && c.total_time > 0.0 {
        (1, c.total_profit / c.total_time)
    } else {
        (0, c.total_profit)
    }
}

fn consider(best: &mut Option<Chain>, c: &Chain) {
    let better = match best {
        None => true,
        Some(b) => chain_key(c) > chain_key(b),
    };
    if better {
        *best = Some(c.clone());
    }
}

/// Beam search glouton. Renvoie la meilleure chaîne (fermée OU ouverte selon `closed`).
fn run_loop(
    legs_from: &std::collections::HashMap<String, Vec<LegStatic>>,
    resource: &str,
    budget0: f64,
    closed: bool,
    max_hops: i64,
    beam_width: usize,
) -> LoopResult {
    use std::collections::HashSet;
    const CAND_PER_NODE: usize = 6;

    let none_result = || -> LoopResult {
        let note = if closed {
            "Aucune boucle fermée rentable trouvée — essaie plus de points ou le mode ouvert."
        } else {
            "Aucune chaîne rentable trouvée pour cette ressource (prix Cargo à synchroniser ?)."
        };
        LoopResult {
            legs: vec![],
            total_profit: 0.0,
            total_time_minutes: None,
            hops: 0,
            closed: false,
            start_location: String::new(),
            end_location: String::new(),
            note: Some(note.to_string()),
        }
    };

    // Legs de départ = ceux dont la commodité == ressource choisie.
    let mut starts: Vec<&LegStatic> = legs_from
        .values()
        .flatten()
        .filter(|l| l.commodity.eq_ignore_ascii_case(resource))
        .collect();
    starts.sort_by(|a, b| leg_potential(b).partial_cmp(&leg_potential(a)).unwrap_or(std::cmp::Ordering::Equal));

    let mut beam: Vec<Chain> = Vec::new();
    for l in starts.into_iter().take(beam_width) {
        let qty = qty_for(l, budget0);
        if qty < 1 {
            continue;
        }
        let profit = l.margin_unit * qty as f64;
        if profit <= 0.0 {
            continue;
        }
        let mut used = HashSet::new();
        used.insert((l.commodity.clone(), l.from_key.clone(), l.to_key.clone()));
        beam.push(Chain {
            legs: vec![l.clone()],
            qtys: vec![qty],
            used,
            budget: budget0 + profit,
            total_profit: profit,
            total_time: l.time_minutes.unwrap_or(0.0),
            all_timed: l.time_minutes.is_some(),
            start_key: l.from_key.clone(),
            start_name: l.from_name.clone().unwrap_or_else(|| l.from_location.clone()),
            cur_key: l.to_key.clone(),
            cur_name: l.to_name.clone().unwrap_or_else(|| l.to_location.clone()),
        });
    }
    if beam.is_empty() {
        return none_result();
    }

    let mut best_open: Option<Chain> = None;
    let mut best_closed: Option<Chain> = None;
    for c in &beam {
        consider(&mut best_open, c); // 1 saut ne peut pas fermer (from != to garanti)
    }

    let cap = max_hops.clamp(1, 30) as usize;
    for _depth in 1..cap {
        let mut next: Vec<Chain> = Vec::new();
        for c in &beam {
            let Some(cands) = legs_from.get(&c.cur_key) else { continue };
            let mut taken = 0usize;
            for l in cands {
                let closes = l.to_key == c.start_key;
                // Limite de candidats par nœud, MAIS un leg qui ferme (mode fermé) est
                // toujours autorisé (ne pas rater une fermeture rangée plus bas).
                if taken >= CAND_PER_NODE && !(closed && closes) {
                    continue;
                }
                let key = (l.commodity.clone(), l.from_key.clone(), l.to_key.clone());
                if c.used.contains(&key) {
                    continue;
                }
                let qty = qty_for(l, c.budget);
                if qty < 1 {
                    continue;
                }
                let profit = l.margin_unit * qty as f64;
                if profit <= 0.0 {
                    continue;
                }
                taken += 1;
                let mut nc = c.clone();
                nc.legs.push(l.clone());
                nc.qtys.push(qty);
                nc.used.insert(key);
                nc.budget += profit;
                nc.total_profit += profit;
                match l.time_minutes {
                    Some(t) => nc.total_time += t,
                    None => nc.all_timed = false,
                }
                nc.cur_key = l.to_key.clone();
                nc.cur_name = l.to_name.clone().unwrap_or_else(|| l.to_location.clone());
                consider(&mut best_open, &nc);
                if nc.cur_key == nc.start_key {
                    consider(&mut best_closed, &nc);
                }
                next.push(nc);
            }
        }
        if next.is_empty() {
            break;
        }
        next.sort_by(|a, b| chain_key(b).partial_cmp(&chain_key(a)).unwrap_or(std::cmp::Ordering::Equal));
        next.truncate(beam_width);
        beam = next;
    }

    let chosen = if closed { best_closed } else { best_open };
    match chosen {
        None => none_result(),
        Some(c) => {
            let legs: Vec<CargoRoute> = c
                .legs
                .iter()
                .zip(c.qtys.iter())
                .map(|(l, q)| leg_to_route(l, *q))
                .collect();
            LoopResult {
                total_time_minutes: if c.all_timed { Some(c.total_time) } else { None },
                hops: legs.len() as i64,
                closed: c.cur_key == c.start_key,
                start_location: c.start_name.clone(),
                end_location: c.cur_name.clone(),
                total_profit: c.total_profit,
                legs,
                note: None,
            }
        }
    }
}

/// Commande : planificateur de BOUCLE. `mode` = "closed" | "open". `max_hops = None` ⇒
/// illimité (plafonné en interne à 30 sauts + arrêt quand plus aucun leg rentable).
#[tauri::command]
pub async fn find_cargo_loop(
    app: AppHandle,
    resource: String,
    ship_name: String,
    budget: f64,
    mode: String,
    max_hops: Option<i64>,
    system: Option<String>,
) -> Result<LoopResult, String> {
    if !(budget.is_finite() && budget > 0.0) {
        return Err("Budget invalide.".into());
    }
    let m = load_market(&app, &ship_name).await?;
    let sys_filter = system.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let legs_from = build_legs(&m, sys_filter);
    let closed = mode.eq_ignore_ascii_case("closed");
    let cap = match max_hops {
        Some(n) => n.clamp(1, 10),
        None => 30,
    };
    let res = run_loop(&legs_from, &resource, budget, closed, cap, 8);
    eprintln!(
        "[cargo_routes] LOOP {} ({}, {} pts) ressource={:?} budget={:.0} → {} sauts, profit {:.0}, fermée={}",
        ship_name,
        if closed { "fermée" } else { "ouverte" },
        cap,
        resource,
        budget,
        res.hops,
        res.total_profit,
        res.closed,
    );
    Ok(res)
}

/// Liste des commodités achetables — sélecteur ressource du planificateur de boucle.
#[tauri::command]
pub async fn get_cargo_commodities(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<String>, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);
    let rows = sqlx::query(
        "SELECT DISTINCT commodityName FROM UexCommodityPrice
          WHERE priceBuy > 0 AND commodityName IS NOT NULL AND commodityName <> ''
          ORDER BY commodityName",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("commodityName").ok())
        .collect())
}

/// Commande exposée : meilleures routes profit/temps pour un vaisseau + budget.
#[tauri::command]
pub async fn find_cargo_routes(
    app: AppHandle,
    ship_name: String,
    investment: f64,
    system: Option<String>,
    limit: Option<i64>,
) -> Result<FindRoutesResult, String> {
    let lim = limit.unwrap_or(50).clamp(1, 500);
    find_cargo_routes_core(&app, ship_name, investment, system, lim).await
}

/* ════════════ GPS trading — navigation pas-à-pas (LOT 1, 100 % lecture) ═══════════ */

/// Denrée achetable à un carrefour (vue GPS). `out_of_stock` = rupture (stock courant 0).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsBuyItem {
    commodity: String,
    buy_price: f64,
    stock: Option<i64>,
    status_buy: Option<i64>,
    out_of_stock: bool,
}

/// Un leg du graphe GPS = CargoRoute (compat modale détails + soute) + clés de carrefour
/// (pour chaîner front en mémoire) + affluence estimée.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsLeg {
    #[serde(flatten)]
    route: CargoRoute,
    from_key: String,
    to_key: String,
    affluence: String,
}

/// Position d'un lieu (carte du LOT 2 — déjà présent dans Market, exposé dès maintenant).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsPos {
    x: f64,
    y: f64,
    z: f64,
    system: Option<String>,
}

/// Référence de lieu pour le sélecteur de départ.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsLocation {
    key: String,
    name: String,
    system: Option<String>,
}

/// Graphe de trading complet d'un vaisseau, chargé en UN appel : la navigation pas-à-pas
/// (carrefour → reventes → confirmation → nouveau carrefour) + le breadcrumb se font
/// ensuite 100 % côté front, sans recalcul backend par étape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeGraph {
    ship_name: String,
    cargo_scu: Option<i64>,
    qt_resolved: bool,
    /// Autonomie quantique max du vaisseau (Gm). None si non synchronisée.
    quantum_range_gm: Option<f64>,
    /// Capacité du réservoir de carburant quantique (SCU). None si non synchronisée.
    quantum_fuel_scu: Option<f64>,
    legs_from: std::collections::HashMap<String, Vec<GpsLeg>>,
    buyable_at: std::collections::HashMap<String, Vec<GpsBuyItem>>,
    positions: std::collections::HashMap<String, GpsPos>,
    locations: Vec<GpsLocation>,
}

/// Commande GPS trading : renvoie le graphe complet (legs par carrefour + achetable@lieu +
/// positions) pour un vaisseau. Réutilise load_market + build_legs (mêmes filtres/caveats
/// que le single-hop et la boucle : fraîcheur ≤ 14 j, bande médiane, stock/demande).
#[tauri::command]
pub async fn get_trade_graph(
    app: AppHandle,
    ship_name: String,
    system: Option<String>,
) -> Result<TradeGraph, String> {
    use std::collections::HashMap;

    let m = load_market(&app, &ship_name).await?;
    let sys_filter = system.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let legs_static = build_legs(&m, sys_filter);

    // Quantité « pleine cargaison » par leg : plafond statique sinon capacité du vaisseau.
    let full_qty = |l: &LegStatic| -> i64 {
        if l.cargo_cap == i64::MAX {
            m.cargo_scu.filter(|c| *c > 0).unwrap_or(1)
        } else {
            l.cargo_cap
        }
    };

    let mut legs_from: HashMap<String, Vec<GpsLeg>> = HashMap::new();
    for (k, legs) in &legs_static {
        // Dédoublonnage par (denrée, destination) : si un lieu a plusieurs terminaux
        // d'achat d'une même denrée (ex. Lorville CBD + L19), garde le MEILLEUR profit
        // vers une destination donnée → pas de destination répétée dans "Autres reventes".
        let mut best: HashMap<(String, String), GpsLeg> = HashMap::new();
        for l in legs {
            let leg = GpsLeg {
                route: leg_to_route(l, full_qty(l)),
                from_key: l.from_key.clone(),
                to_key: l.to_key.clone(),
                affluence: l.affluence.clone(),
            };
            let dk = (leg.route.commodity.clone(), leg.to_key.clone());
            match best.get(&dk) {
                Some(prev) if prev.route.profit >= leg.route.profit => {}
                _ => {
                    best.insert(dk, leg);
                }
            }
        }
        // Tri « meilleure revente d'abord » : profit/min décroissant (timées en tête),
        // sinon profit brut — mêmes critères que le moteur.
        let mut out: Vec<GpsLeg> = best.into_values().collect();
        out.sort_by(|a, b| match (a.route.profit_per_minute, b.route.profit_per_minute) {
            (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.route.profit.partial_cmp(&a.route.profit).unwrap_or(std::cmp::Ordering::Equal),
        });
        legs_from.insert(k.clone(), out);
    }

    // Denrées TRADABLES par lieu = celles ayant au moins une revente rentable (≥ 1 leg).
    // Sert à masquer du carrefour GPS les denrées sans marché (munitions/consommables) ou
    // en perte (carburants), sans toucher au stock (la rupture reste affichée, pas masquée).
    let mut tradable: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    for (k, legs) in &legs_from {
        let set = tradable.entry(k.clone()).or_default();
        for l in legs {
            set.insert(l.route.commodity.clone());
        }
    }

    // Résout le système d'un lieu (via slug → uuid → position) pour le filtre éventuel.
    let key_system = |key: &str| -> Option<String> {
        m.slug_uuid.get(key).and_then(|u| m.pos.get(u)).and_then(|p| p.system.clone())
    };

    // Achetable@lieu : UNE entrée par denrée (Correctif 2a), restreinte aux denrées
    // TRADABLES (Correctif 1). Meilleur point d'achat = en stock d'abord, puis prix le
    // plus bas. Une denrée tradable en rupture est CONSERVÉE (affichée barrée), pas masquée.
    let mut best_buy: HashMap<(String, String), &PricePoint> = HashMap::new();
    for (commodity, buys) in &m.buy_points {
        for bp in buys {
            let key = bp.slug.clone().unwrap_or_else(|| bp.location.clone());
            if let Some(f) = sys_filter {
                if !key_system(&key).map(|s| s.eq_ignore_ascii_case(f)).unwrap_or(false) {
                    continue;
                }
            }
            // Masque les denrées sans revente rentable depuis ce lieu (0 leg).
            if !tradable.get(&key).map(|s| s.contains(commodity)).unwrap_or(false) {
                continue;
            }
            let dk = (key, commodity.clone());
            let better = match best_buy.get(&dk) {
                None => true,
                Some(prev) => {
                    let prev_oos = prev.stock_cur == Some(0);
                    let cur_oos = bp.stock_cur == Some(0);
                    if prev_oos != cur_oos {
                        !cur_oos // préfère un point en stock
                    } else {
                        bp.price < prev.price // sinon prix d'achat le plus bas
                    }
                }
            };
            if better {
                best_buy.insert(dk, bp);
            }
        }
    }
    let mut buyable_at: HashMap<String, Vec<GpsBuyItem>> = HashMap::new();
    for ((key, commodity), bp) in best_buy {
        buyable_at.entry(key).or_default().push(GpsBuyItem {
            commodity,
            buy_price: bp.price,
            stock: bp.stock_cur,
            status_buy: bp.status,
            out_of_stock: bp.stock_cur == Some(0),
        });
    }
    for v in buyable_at.values_mut() {
        v.sort_by(|a, b| a.commodity.to_lowercase().cmp(&b.commodity.to_lowercase()));
    }

    // Positions (clé lieu → x/y/z) pour la carte du LOT 2.
    let mut positions: HashMap<String, GpsPos> = HashMap::new();
    for (key, uuid) in &m.slug_uuid {
        if let Some(p) = m.pos.get(uuid) {
            positions.insert(key.clone(), GpsPos { x: p.x, y: p.y, z: p.z, system: p.system.clone() });
        }
    }

    // Lieux de départ = ceux où l'on peut acheter, avec nom lisible, triés par nom.
    let mut locations: Vec<GpsLocation> = buyable_at
        .keys()
        .map(|k| GpsLocation {
            key: k.clone(),
            name: m.slug_name.get(k).cloned().unwrap_or_else(|| k.clone()),
            system: positions.get(k).and_then(|p| p.system.clone()),
        })
        .collect();
    locations.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    eprintln!(
        "[cargo_routes] TRADE_GRAPH {} → {} carrefours, {} lieux achetables, {} positions",
        ship_name,
        legs_from.len(),
        buyable_at.len(),
        positions.len(),
    );

    Ok(TradeGraph {
        ship_name,
        cargo_scu: m.cargo_scu,
        qt_resolved: m.qt_resolved,
        quantum_range_gm: m.quantum_range_gm,
        quantum_fuel_scu: m.quantum_fuel_scu,
        legs_from,
        buyable_at,
        positions,
        locations,
    })
}

/// Démo dev : auto-sélectionne le vaisseau de la flotte au plus gros cargo, lance le
/// moteur sur `investment` et renvoie le résultat (top `limit`). Pour le bouton Diagnostic.
#[tauri::command]
pub async fn find_cargo_routes_demo(
    app: AppHandle,
    investment: Option<f64>,
    limit: Option<i64>,
) -> Result<FindRoutesResult, String> {
    let budget = investment.unwrap_or(1_000_000.0);
    let lim = limit.unwrap_or(10).clamp(1, 100);

    let ship_name = {
        let instances = app.state::<DbInstances>();
        let lock = instances.0.read().await;
        let pool: &Pool<Sqlite> = pool_from!(lock);
        let row = sqlx::query(
            "SELECT s.name AS name
               FROM Ship s JOIN ShipData sd ON sd.name = s.name COLLATE NOCASE
              WHERE sd.cargoScu IS NOT NULL
              ORDER BY sd.cargoScu DESC
              LIMIT 1",
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        match row {
            Some(r) => r.try_get::<String, _>("name").map_err(|e| e.to_string())?,
            None => {
                let any = sqlx::query("SELECT name FROM Ship ORDER BY name LIMIT 1")
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                match any {
                    Some(r) => r.try_get::<String, _>("name").map_err(|e| e.to_string())?,
                    None => return Err("Aucun vaisseau dans la flotte (table Ship vide).".into()),
                }
            }
        }
    };

    find_cargo_routes_core(&app, ship_name, budget, None, lim).await
}

/// Wrapper DASHBOARD : top routes du plus gros cargo du COMPTE ACTIF. Moteur 100 % base
/// (rapide < 1 s) → recalcul à l'ouverture du dashboard acceptable. Renvoie `None` si pas
/// de compte actif ou aucun vaisseau cargo sur ce compte (le widget affichera « aucune
/// route ») ; si prix UEX/positions absents, le moteur renvoie simplement des routes vides.
/// Jamais d'erreur bloquante pour le dashboard.
#[tauri::command]
pub async fn get_dashboard_top_routes(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Option<FindRoutesResult>, String> {
    let lim = limit.unwrap_or(3).clamp(1, 20);

    // Plus gros cargo du COMPTE ACTIF (même filtre que get_cargo_fleet_ships). Le verrou
    // est relâché en fin de bloc, avant l'appel au moteur (qui prend son propre verrou).
    let ship_name: Option<String> = {
        let instances = app.state::<DbInstances>();
        let lock = instances.0.read().await;
        let pool: &Pool<Sqlite> = pool_from!(lock);

        let active = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|r| r.try_get::<String, _>("value").ok());
        let Some(account_id) = active else {
            return Ok(None);
        };

        sqlx::query(
            "SELECT s.name AS name
               FROM Ship s
               JOIN ShipData sd ON sd.name = s.name COLLATE NOCASE
              WHERE s.accountId = ? AND sd.cargoScu IS NOT NULL AND sd.cargoScu > 0
              ORDER BY sd.cargoScu DESC, s.name ASC
              LIMIT 1",
        )
        .bind(&account_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("name").ok())
    };

    let Some(ship_name) = ship_name else {
        return Ok(None);
    };

    let res = find_cargo_routes_core(&app, ship_name, 1_000_000.0, None, lim).await?;
    Ok(Some(res))
}

/// Vaisseaux de la flotte du compte actif, avec capacité SCU (catalogue), triés cargo
/// décroissant (les plus gros porteurs d'abord) pour le sélecteur du planificateur.
#[tauri::command]
pub async fn get_cargo_fleet_ships(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let active = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());
    let Some(account_id) = active else {
        return Ok(serde_json::json!([]));
    };

    let rows = sqlx::query(
        "SELECT s.name AS name, s.manufacturer AS manufacturer, sd.cargoScu AS cargoScu, sd.role AS role
           FROM Ship s
           LEFT JOIN ShipData sd ON sd.name = s.name COLLATE NOCASE
          WHERE s.accountId = ?
          ORDER BY (sd.cargoScu IS NULL) ASC, sd.cargoScu DESC, s.name ASC",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Dédup par nom (un même modèle possédé en plusieurs exemplaires = une seule entrée).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for r in &rows {
        let name: String = r.try_get("name").unwrap_or_default();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        out.push(serde_json::json!({
            "name": name,
            "manufacturer": r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
            "cargoScu": r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
            "role": r.try_get::<Option<String>, _>("role").ok().flatten(),
        }));
    }
    Ok(Value::Array(out))
}

/// TOUS les vaisseaux cargo du catalogue (ShipData.cargoScu > 0), triés cargo décroissant.
/// Pour le groupe « Tous les vaisseaux cargo » du sélecteur (stats QT par défaut = drive
/// stock, résolu par find_cargo_routes comme pour la flotte). `qtDefault` = a-t-on un QT
/// stock résolvable (sinon profit/min indisponible → marge brute).
#[tauri::command]
pub async fn get_cargo_catalog_ships(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let rows = sqlx::query(
        "SELECT sd.name AS name, sd.manufacturer AS manufacturer, sd.cargoScu AS cargoScu, sd.role AS role,
                EXISTS (SELECT 1 FROM ShipHardpoint h JOIN Component c ON c.className = h.defaultComponentClassName
                        WHERE h.shipId = sd.id AND h.type = 'QUANTUM_DRIVE' AND c.qtDriveSpeed IS NOT NULL) AS qtDefault
           FROM ShipData sd
          WHERE sd.cargoScu > 0
          ORDER BY sd.cargoScu DESC, sd.name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for r in &rows {
        let name: String = r.try_get("name").unwrap_or_default();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        out.push(serde_json::json!({
            "name": name,
            "manufacturer": r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
            "cargoScu": r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
            "role": r.try_get::<Option<String>, _>("role").ok().flatten(),
            "qtDefault": r.try_get::<i64, _>("qtDefault").unwrap_or(0) != 0,
        }));
    }
    Ok(Value::Array(out))
}

/* ════════════ Modale « Détails de la route » — hiérarchie d'un lieu ═══════════ */
// Reconstitue la chaîne de parenté d'un lieu (Système → Planète → [Lune] → Lieu) par
// remontées successives de parentSlug dans WikiStarmapLocation (parent DIRECT seulement
// en base, mais chaîne complète reconstituable). web_url déterministe depuis le slug.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyNode {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub type_class: Option<String>,
    pub designation: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationHierarchy {
    pub system: Option<String>,
    pub levels: Vec<HierarchyNode>, // haut → bas, étoile racine retirée
}

/// web_url officiel SC Wiki, déterministe depuis le slug (vérifié : /locations/{slug}).
fn wiki_web_url(slug: &str) -> String {
    format!("https://api.star-citizen.wiki/locations/{slug}")
}

/// Chaîne de parenté d'un lieu (par uuid Wiki). Niveau manquant → chaîne partielle, jamais d'erreur.
#[tauri::command]
pub async fn get_location_hierarchy(
    uuid: String,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<LocationHierarchy, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    // Lieu de départ (par uuid) → slug + système.
    let start = sqlx::query("SELECT slug, systemName FROM WikiStarmapLocation WHERE uuid = ? LIMIT 1")
        .bind(&uuid)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let Some(start) = start else {
        return Ok(LocationHierarchy { system: None, levels: Vec::new() });
    };
    let system: Option<String> = start.try_get::<Option<String>, _>("systemName").ok().flatten();
    let mut cur_slug: Option<String> = start.try_get::<Option<String>, _>("slug").ok().flatten();

    // Remontée bottom→top via parentSlug (garde-fou anti-boucle).
    let mut chain: Vec<HierarchyNode> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    while let Some(slug) = cur_slug.clone() {
        if slug.is_empty() || !seen.insert(slug.clone()) {
            break;
        }
        let row = sqlx::query(
            "SELECT name, slug, typeClassification, designation, parentSlug
               FROM WikiStarmapLocation WHERE slug = ? LIMIT 1",
        )
        .bind(&slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        let Some(row) = row else { break };
        let node_slug: Option<String> = row.try_get::<Option<String>, _>("slug").ok().flatten();
        chain.push(HierarchyNode {
            name: row.try_get::<Option<String>, _>("name").ok().flatten(),
            web_url: node_slug.as_deref().map(wiki_web_url),
            slug: node_slug,
            type_class: row.try_get::<Option<String>, _>("typeClassification").ok().flatten(),
            designation: row.try_get::<Option<String>, _>("designation").ok().flatten(),
        });
        cur_slug = row.try_get::<Option<String>, _>("parentSlug").ok().flatten();
        if chain.len() > 16 {
            break; // sécurité
        }
    }

    // Retire l'étoile racine (le système est affiché à part), puis haut → bas.
    if matches!(chain.last().and_then(|n| n.type_class.as_deref()), Some("Star")) {
        chain.pop();
    }
    chain.reverse();

    Ok(LocationHierarchy { system, levels: chain })
}
