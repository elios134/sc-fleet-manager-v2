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

const DB_URL: &str = "sqlite:scfleet.db";
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

/* ══════════════════ Phase B' — cache des prix (commodity-listings) ═════════════ */

const LISTINGS_PAGE_SIZE_HINT: u64 = 100; // info ; la taille réelle vient de page.size
const LISTINGS_MAX_PAGES: u32 = 500; // garde-fou anti-boucle (réel ~115 pages)
const LISTINGS_PAGE_RETRIES: u32 = 3;

/// GET d'une page de listings avec retries (réseau / 5xx / 429). Erreur dure après N essais.
async fn fetch_listings_page(client: &reqwest::Client, page: u32) -> Result<Value, String> {
    let url = format!("{TRADE_BASE}/api/crowdsource/commodity-listings?page={page}");
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match client.get(&url).send().await {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return r.json::<Value>().await.map_err(|e| e.to_string());
                }
                if (status.as_u16() == 429 || status.is_server_error()) && attempt < LISTINGS_PAGE_RETRIES {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    continue;
                }
                return Err(format!("HTTP {status} sur page {page}"));
            }
            Err(e) => {
                if attempt < LISTINGS_PAGE_RETRIES {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    continue;
                }
                return Err(format!("réseau page {page} : {e}"));
            }
        }
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CargoPriceSyncReport {
    pub pages_fetched: i64,
    pub raw_rows: i64,
    pub dedup_rows: i64,
    pub locations_covered: i64,
    pub locations_linked: i64,
    pub locations_unlinked: i64,
    pub oldest_timestamp: Option<String>,
    pub freshest_timestamp: Option<String>,
    pub errors: Vec<String>,
}

struct PriceRow {
    location: String,
    commodity: String,
    transaction: String,
    price: Option<f64>,
    quantity: Option<i64>,
    saturation: Option<f64>,
    timestamp: Option<String>,
    batch_id: Option<String>,
}

/// Sync des prix : pull complet borné de commodity-listings, dédup par
/// (location, commodity, transaction) en gardant le timestamp le PLUS RÉCENT.
///
/// STRATÉGIE = pull complet borné (les ~115 pages), pas de seuil d'âge. Justification :
/// le flux est petit (~11 k lignes, ~3 Mo) et déjà dédupliqué à la fin par triplet ;
/// un pull complet est le plus robuste (couvre TOUTES les locations/commodités, pas de
/// trou si une zone n'a pas été re-scannée récemment). Un seuil d'âge risquerait de
/// rater des lieux peu fréquentés. Garde-fou : `LISTINGS_MAX_PAGES`.
///
/// ANTI-CORRUPTION : on agrège tout en mémoire ; si une page échoue durablement, on
/// renvoie Err AVANT tout DELETE (cache existant préservé). On refuse aussi un résultat
/// vide (ne jamais écraser par du vide).
async fn sync_cargo_prices_core(app: &AppHandle, client: &reqwest::Client) -> Result<CargoPriceSyncReport, String> {
    use std::collections::HashMap;

    let mut report = CargoPriceSyncReport::default();
    // Clé triplet → meilleure ligne (timestamp max). Comparaison lexicographique sur ISO
    // (format fixe, même offset +00:00 ⇒ ordre chronologique correct).
    let mut best: HashMap<(String, String, String), PriceRow> = HashMap::new();

    let mut page = 0u32;
    let mut total_pages = 1u32;
    loop {
        let json = fetch_listings_page(client, page).await?; // échec dur → Err, cache intact
        report.pages_fetched += 1;

        if let Some(tp) = json.get("page").and_then(|p| p.get("totalPages")).and_then(|v| v.as_u64()) {
            total_pages = tp as u32;
        }
        let content = json.get("content").and_then(|c| c.as_array());
        let Some(content) = content else {
            // Enveloppe inattendue : on stoppe proprement sans corrompre.
            return Err(format!("page {page} : champ 'content' absent/invalide"));
        };
        if content.is_empty() {
            break;
        }

        for it in content {
            let Some(location) = it.get("location").and_then(|v| v.as_str()).map(|s| s.trim().to_string()) else {
                continue;
            };
            let Some(commodity) = it.get("commodity").and_then(|v| v.as_str()).map(|s| s.trim().to_string()) else {
                continue;
            };
            let Some(transaction) = it.get("transaction").and_then(|v| v.as_str()).map(|s| s.trim().to_string()) else {
                continue;
            };
            if location.is_empty() || commodity.is_empty() || transaction.is_empty() {
                continue;
            }
            report.raw_rows += 1;
            let row = PriceRow {
                location: location.clone(),
                commodity: commodity.clone(),
                transaction: transaction.clone(),
                price: it.get("price").and_then(|v| v.as_f64()),
                quantity: it.get("quantity").and_then(|v| v.as_i64()),
                saturation: it.get("saturation").and_then(|v| v.as_f64()),
                timestamp: it.get("timestamp").and_then(|v| v.as_str()).map(|s| s.to_string()),
                batch_id: it.get("batchId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            };
            let key = (location, commodity, transaction);
            match best.get(&key) {
                Some(prev) if prev.timestamp >= row.timestamp => { /* déjà plus frais (newest-first) */ }
                _ => {
                    best.insert(key, row);
                }
            }
        }

        page += 1;
        if page >= total_pages || page >= LISTINGS_MAX_PAGES {
            break;
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }

    // Garde-fou : jamais écraser par du vide.
    if best.is_empty() {
        return Err("commodity-listings : 0 ligne récupérée — cache de prix conservé".into());
    }
    report.dedup_rows = best.len() as i64;

    // Fraîcheur min/max + slug de location pour le rattachement.
    let mut oldest: Option<String> = None;
    let mut freshest: Option<String> = None;
    for r in best.values() {
        if let Some(ts) = &r.timestamp {
            if oldest.as_ref().map(|o| ts < o).unwrap_or(true) {
                oldest = Some(ts.clone());
            }
            if freshest.as_ref().map(|f| ts > f).unwrap_or(true) {
                freshest = Some(ts.clone());
            }
        }
    }
    report.oldest_timestamp = oldest;
    report.freshest_timestamp = freshest;

    // ── Écriture + rattachement au référentiel ──
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // Slugs rattachables = tradeSlug du mapping (depuis les boutiques) ∪ alias manuels.
    let map_rows = sqlx::query(
        "SELECT tradeSlug FROM CargoLocationMapping
         UNION SELECT tradeSlug FROM CargoLocationAlias",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let known_slugs: std::collections::HashSet<String> =
        map_rows.iter().filter_map(|r| r.try_get::<String, _>("tradeSlug").ok()).collect();

    // Classement des locations de prix (distinctes) : rattachées vs non.
    let mut covered: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unlinked: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in best.values() {
        if !covered.insert(r.location.clone()) {
            continue;
        }
        let slug = slugify(&leaf_of(&r.location));
        if slug.is_empty() || !known_slugs.contains(&slug) {
            unlinked.insert(r.location.clone());
        }
    }
    report.locations_covered = covered.len() as i64;
    report.locations_unlinked = unlinked.len() as i64;
    report.locations_linked = report.locations_covered - report.locations_unlinked;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoPriceListing").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    for r in best.values() {
        let slug = slugify(&leaf_of(&r.location));
        sqlx::query(
            "INSERT OR REPLACE INTO CargoPriceListing
               (location, commodity, \"transaction\", price, quantity, saturation, timestamp, batchId, locationSlug, syncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&r.location)
        .bind(&r.commodity)
        .bind(&r.transaction)
        .bind(r.price)
        .bind(r.quantity)
        .bind(r.saturation)
        .bind(&r.timestamp)
        .bind(&r.batch_id)
        .bind(if slug.is_empty() { None } else { Some(slug) })
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    if !unlinked.is_empty() {
        let mut sample: Vec<&String> = unlinked.iter().collect();
        sample.sort();
        eprintln!(
            "[cargo_routes] PRIX — {} location(s) non rattachée(s) au référentiel (slug absent du mapping) : {}",
            unlinked.len(),
            sample.iter().take(30).map(|s| s.as_str()).collect::<Vec<_>>().join(" | ")
        );
    }
    eprintln!(
        "[cargo_routes] SYNC PRIX — pages:{} brut:{} dédup:{} | locations {} (rattachées {}, non {}) | fraîcheur {:?}..{:?}",
        report.pages_fetched,
        report.raw_rows,
        report.dedup_rows,
        report.locations_covered,
        report.locations_linked,
        report.locations_unlinked,
        report.oldest_timestamp,
        report.freshest_timestamp,
    );
    let _ = LISTINGS_PAGE_SIZE_HINT;
    Ok(report)
}

/// Commande exposée : sync du cache de prix (pull complet borné, dédup plus-frais).
#[tauri::command]
pub async fn sync_cargo_prices(app: AppHandle) -> Result<CargoPriceSyncReport, String> {
    let trade = trade_client()?;
    sync_cargo_prices_core(&app, &trade).await
}

/// État du cache de prix : nb lignes, fraîcheur min/max, locations couvertes / non rattachées.
#[tauri::command]
pub async fn get_cargo_prices_status(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let agg = sqlx::query(
        "SELECT COUNT(*) AS rows,
                COUNT(DISTINCT location) AS locs,
                MIN(timestamp) AS oldest,
                MAX(timestamp) AS freshest,
                SUM(CASE WHEN \"transaction\"='BUYS'  THEN 1 ELSE 0 END) AS buys,
                SUM(CASE WHEN \"transaction\"='SELLS' THEN 1 ELSE 0 END) AS sells
           FROM CargoPriceListing",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Locations non rattachées : slug absent du mapping ET des alias.
    let unlinked = sqlx::query(
        "SELECT COUNT(DISTINCT location) AS c
           FROM CargoPriceListing
          WHERE locationSlug IS NULL
             OR (locationSlug NOT IN (SELECT tradeSlug FROM CargoLocationMapping)
                 AND locationSlug NOT IN (SELECT tradeSlug FROM CargoLocationAlias))",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "rows": agg.try_get::<i64, _>("rows").unwrap_or(0),
        "locationsCovered": agg.try_get::<i64, _>("locs").unwrap_or(0),
        "locationsUnlinked": unlinked.try_get::<i64, _>("c").unwrap_or(0),
        "oldestTimestamp": agg.try_get::<Option<String>, _>("oldest").ok().flatten(),
        "freshestTimestamp": agg.try_get::<Option<String>, _>("freshest").ok().flatten(),
        "buys": agg.try_get::<i64, _>("buys").unwrap_or(0),
        "sells": agg.try_get::<i64, _>("sells").unwrap_or(0),
    }))
}

/* ════════════ Phase C' (1/2) — MOTEUR de calcul profit/temps (backend) ═══════════ */
// Routes A→B simples (maxStops=1) : achat (boutique SELLS) → revente (boutique BUYS).
// Socle = marge brute (toujours calculable). Couche distance/temps PAR-DESSUS, ISOLÉE :
// si une position manque, la route reste (profitPerMinute=null), jamais de crash.
//
// MODÈLE DE TEMPS (assumé, signalé) : timeSec = qtSpool×legs + distance / qtDriveSpeed.
//   • Approximation distance/vitesse + spool par saut quantique (pas de rampe accel/vmax
//     comme SC Wiki). Suffisant pour ce lot ; affinable plus tard.
//   • qtDriveSpeed/qtSpool = drive QUANTUM STOCK du vaisseau (ShipHardpoint→Component).
// HYPOTHÈSE QUANTITÉ : `quantity` <= 0 (ou NULL) du flux de prix = « non renseigné » →
//   PAS de contrainte de stock (sinon ~tous les lots seraient bornés à 0). Seules les
//   quantités strictement positives bornent la quantité réalisable.
// CARBURANT : laissé à plus tard (fuel=null) — unités de qtFuelRate non vérifiées.

/* ── Filtres QUALITÉ des données (crowdsource bruité). Constantes ajustables. ── */
// Le flux contient des scans aberrants (ex. agricultural supplies ~812 000 aUEC/SCU).
// 3 garde-fous défendables, faciles à calibrer ici :

/// (1) Cap de ratio de marge : on rejette une route si sellPrice/buyPrice dépasse ce
/// facteur. 10× est large — le hauling réel tourne entre 1,05× et ~2× ; au-delà de 10×
/// c'est presque toujours un prix d'achat aberrant (≈0) ou de vente aberrant. Laisse
/// passer les routes très lucratives mais réalistes, tue les artefacts.
const MAX_MARGIN_RATIO: f64 = 10.0;

/// (2) Bande de prix autour de la MÉDIANE par marchandise : on écarte toute ligne de
/// prix > FACTEUR×médiane ou < médiane/FACTEUR (médiane robuste aux outliers). 5×
/// garde la variabilité légitime entre lieux mais coupe les scans absurdes.
const MEDIAN_BAND_FACTOR: f64 = 5.0;

/// (3) Temps PLANCHER d'une route (minutes) : inclut chargement/déchargement + manœuvres.
/// Évite qu'un trajet quasi-nul (deux lieux ~collés) gonfle le profit/min à l'infini.
const MIN_ROUTE_MINUTES: f64 = 2.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoRoute {
    pub commodity: String,
    pub from_location: String,
    pub to_location: String,
    pub from_name: Option<String>,
    pub to_name: Option<String>,
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
    pub fuel: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRoutesResult {
    pub ship_name: String,
    pub cargo_scu: Option<i64>,
    pub qt_drive_speed: Option<f64>,
    pub qt_spool_time: Option<f64>,
    pub qt_resolved: bool,
    pub investment: f64,
    pub routes_considered: i64,
    pub routes_with_time: i64,
    pub price_points_dropped_band: i64,
    pub pairs_dropped_ratio: i64,
    pub routes_time_floored: i64,
    pub routes: Vec<CargoRoute>,
    pub note: String,
}

#[derive(Clone)]
struct Pos {
    x: f64,
    y: f64,
    z: f64,
    system: Option<String>,
}

#[derive(Clone)]
struct PricePoint {
    location: String,
    slug: Option<String>,
    price: f64,
    quantity: Option<i64>,
}

fn euclid(a: &Pos, b: &Pos) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Distance achat→vente en mètres + nb de legs quantiques.
///   • même système → euclidien direct (1 leg).
///   • systèmes différents → enchaînement via les jump points (BFS sur le graphe de
///     systèmes). None si une position de porte manque → route en marge brute (sans temps).
fn route_distance(
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

/// Cœur du moteur : lit tout en mémoire (sous le verrou DB), puis calcule à froid.
async fn find_cargo_routes_core(
    app: &AppHandle,
    ship_name: String,
    investment: f64,
    system: Option<String>,
    limit: i64,
) -> Result<FindRoutesResult, String> {
    use std::collections::HashMap;

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // Vaisseau : capacité SCU + drive quantique stock (best-effort).
    let ship_row = sqlx::query(
        "SELECT id, cargoScu FROM ShipData
          WHERE name = ? COLLATE NOCASE OR nameLocalized = ? COLLATE NOCASE
          LIMIT 1",
    )
    .bind(&ship_name)
    .bind(&ship_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (ship_data_id, cargo_scu): (Option<i64>, Option<i64>) = match ship_row {
        Some(r) => (
            r.try_get::<i64, _>("id").ok(),
            r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
        ),
        None => (None, None),
    };

    let mut qt_speed: Option<f64> = None;
    let mut qt_spool: Option<f64> = None;
    if let Some(sid) = ship_data_id {
        if let Some(r) = sqlx::query(
            "SELECT c.qtDriveSpeed, c.qtSpoolTime
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
        }
    }
    let qt_resolved = qt_speed.map(|s| s > 0.0).unwrap_or(false);
    let spool = qt_spool.unwrap_or(0.0);

    // Prix → points d'ACHAT (SELLS) et de REVENTE (BUYS) par commodity.
    let price_rows = sqlx::query(
        "SELECT location, commodity, \"transaction\", price, quantity, locationSlug FROM CargoPriceListing",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut buy_points: HashMap<String, Vec<PricePoint>> = HashMap::new();
    let mut sell_points: HashMap<String, Vec<PricePoint>> = HashMap::new();
    for r in &price_rows {
        let commodity: String = r.try_get("commodity").unwrap_or_default();
        let tx: String = r.try_get("transaction").unwrap_or_default();
        let Some(price) = r.try_get::<Option<f64>, _>("price").ok().flatten() else { continue };
        if commodity.is_empty() || price <= 0.0 {
            continue;
        }
        let pp = PricePoint {
            location: r.try_get("location").unwrap_or_default(),
            slug: r.try_get::<Option<String>, _>("locationSlug").ok().flatten(),
            price,
            quantity: r.try_get::<Option<i64>, _>("quantity").ok().flatten(),
        };
        match tx.as_str() {
            "SELLS" => buy_points.entry(commodity).or_default().push(pp),
            "BUYS" => sell_points.entry(commodity).or_default().push(pp),
            _ => {}
        }
    }

    // ── Filtre (2) : bande de prix autour de la MÉDIANE par marchandise ──
    // Médiane sur TOUS les prix (achat+vente) de la marchandise, puis on écarte les
    // lignes hors [médiane/FACTEUR, médiane×FACTEUR] (coupe les scans aberrants).
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

    // slug → uuid (mapping ∪ alias), puis uuid → position.
    let mut slug_uuid: HashMap<String, String> = HashMap::new();
    for r in sqlx::query("SELECT tradeSlug, wikiUuid FROM CargoLocationMapping WHERE wikiUuid IS NOT NULL")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        let s: String = r.try_get("tradeSlug").unwrap_or_default();
        let u: String = r.try_get("wikiUuid").unwrap_or_default();
        if !s.is_empty() && !u.is_empty() {
            slug_uuid.entry(s).or_insert(u);
        }
    }
    for r in sqlx::query(
        "SELECT a.tradeSlug AS s, l.uuid AS u
           FROM CargoLocationAlias a JOIN WikiStarmapLocation l ON l.slug = a.wikiSlug",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    {
        let s: String = r.try_get("s").unwrap_or_default();
        let u: String = r.try_get("u").unwrap_or_default();
        if !s.is_empty() && !u.is_empty() {
            slug_uuid.entry(s).or_insert(u);
        }
    }

    // slug → nom lisible Wiki (pour afficher des noms propres, pas les chemins bruts).
    let mut slug_name: HashMap<String, String> = HashMap::new();
    for r in sqlx::query(
        "SELECT tradeSlug, wikiName FROM CargoLocationMapping WHERE wikiName IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    {
        let s: String = r.try_get("tradeSlug").unwrap_or_default();
        let n: Option<String> = r.try_get::<Option<String>, _>("wikiName").ok().flatten();
        if let (false, Some(n)) = (s.is_empty(), n) {
            slug_name.entry(s).or_insert(n);
        }
    }
    for r in sqlx::query(
        "SELECT a.tradeSlug AS s, l.name AS n
           FROM CargoLocationAlias a JOIN WikiStarmapLocation l ON l.slug = a.wikiSlug",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    {
        let s: String = r.try_get("s").unwrap_or_default();
        let n: Option<String> = r.try_get::<Option<String>, _>("n").ok().flatten();
        if let (false, Some(n)) = (s.is_empty(), n) {
            slug_name.entry(s).or_insert(n);
        }
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
    let mut routes_time_floored = 0i64;
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
                        distance_gm = Some(dist_m / 1.0e9);
                        jumps = Some(legs - 1);
                        if qt_resolved {
                            let speed = qt_speed.unwrap();
                            let time_sec = spool * legs as f64 + dist_m / speed;
                            // Filtre (3) : temps plancher (chargement/déchargement + manœuvre).
                            let raw_min = time_sec / 60.0;
                            let tm = raw_min.max(MIN_ROUTE_MINUTES);
                            if raw_min < MIN_ROUTE_MINUTES {
                                routes_time_floored += 1;
                            }
                            time_minutes = Some(tm);
                            profit_per_minute = Some(profit / tm);
                        }
                    }
                }

                routes.push(CargoRoute {
                    commodity: commodity.clone(),
                    from_location: bp.location.clone(),
                    to_location: sp.location.clone(),
                    from_name: readable(&bp.slug, &bp.location),
                    to_name: readable(&sp.slug, &sp.location),
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
                    fuel: None,
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
        "Modèle temps = spool×legs + distance/vitesseQT (simple, sans rampe accel). \
         Quantité bornée par budget{}, stock>0. Carburant différé.{}{}",
        if cargo_scu.is_some() { " + cargoScu" } else { " (cargoScu inconnu → non borné)" },
        if qt_resolved { "" } else { " Drive QT non résolu → profit/min indisponible (marge brute)." },
        if pos.is_empty() { " Table positions vide → marge brute pure." } else { "" },
    );

    eprintln!(
        "[cargo_routes] ROUTES {} (budget {:.0}) — {} routes ({} avec temps) | filtres: bande prix -{}, ratio>{}× -{}, temps planché {}",
        ship_name,
        investment,
        routes_considered,
        routes_with_time,
        price_points_dropped_band,
        MAX_MARGIN_RATIO,
        pairs_dropped_ratio,
        routes_time_floored,
    );

    Ok(FindRoutesResult {
        ship_name,
        cargo_scu,
        qt_drive_speed: qt_speed,
        qt_spool_time: qt_spool,
        qt_resolved,
        investment,
        routes_considered,
        routes_with_time,
        price_points_dropped_band,
        pairs_dropped_ratio,
        routes_time_floored,
        routes,
        note,
    })
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
