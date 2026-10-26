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
use crate::commands::travel_physics::qt_travel_seconds;

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
        } else if (c.is_whitespace() || c == '-')
            && !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
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
    let mut report = CargoReferenceSyncReport {
        audit_hubs_total: AUDIT_HUB_SLUGS.len() as i64,
        ..Default::default()
    };

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

mod reference_sync;
pub(crate) use reference_sync::*;
mod engine;
pub(crate) use engine::*;
mod market;
pub(crate) use market::*;
mod loop_planner;
pub(crate) use loop_planner::*;
mod gps_types;
pub(crate) use gps_types::*;
pub(crate) mod trade_graph;
pub(crate) mod lookups;
