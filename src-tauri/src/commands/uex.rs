// Bloc 4 — Bascule UEX : sync du cache de prix + stock RÉELS (api.uexcorp.uk).
// Lecture PUBLIQUE (aucun token). 1 appel /commodities_prices_all (~1 Mo, ~2591 lignes)
// + /terminals (823, hiérarchie + mapping vers WikiStarmapLocation pour les distances).
//
// ⚠️ Convention UEX = point de vue JOUEUR (à NE PAS inverser côté moteur) :
//   price_buy / scu_buy         → le joueur ACHÈTE (point d'achat, prix bas).
//   price_sell / scu_sell_stock → le joueur VEND (point de vente, demande réelle).

use serde::Serialize;
use serde_json::Value;
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
const UEX_BASE: &str = "https://api.uexcorp.uk/2.0";
const REQUEST_TIMEOUT_SECS: u64 = 90;

macro_rules! pool_from {
    ($lock:expr) => {{
        match $lock.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => return Err(format!("Base non chargée : {DB_URL}")),
        }
    }};
}

fn uex_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_data(client: &reqwest::Client, path: &str) -> Result<Vec<Value>, String> {
    let url = format!("{UEX_BASE}/{path}");
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status} sur {url}"));
    }
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    json.get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .ok_or_else(|| format!("{path} : champ 'data' absent/invalide"))
}

/// Normalisation pour le mapping terminal UEX → WikiStarmapLocation :
/// minuscules, on ne garde QUE l'alphanumérique ASCII (espaces/tirets/ponctuation supprimés).
///   "Area 18" → "area18" == slug "area18" / nom "Area18"
///   "Seraphim Station" → "seraphimstation" == slug "seraphim-station"
fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// Retire un suffixe entre parenthèses (ex. "Nyx Gateway (Stanton)" → "Nyx Gateway").
fn strip_paren(s: &str) -> String {
    match s.find('(') {
        Some(i) => s[..i].trim().to_string(),
        None => s.to_string(),
    }
}

fn vstr(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
fn vi64(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64())
}
fn vf64(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UexSyncReport {
    pub terminals: i64,
    pub commodity_terminals: i64,
    pub prices: i64,
    pub terminals_mapped: i64,
    pub terminals_unmapped: i64,
    pub hubs_matched: i64,
    pub hubs_total: i64,
    pub errors: Vec<String>,
}

// 14 hubs d'audit (slug WikiStarmapLocation) pour le contrôle de cohérence.
const AUDIT_HUB_SLUGS: [&str; 14] = [
    "area18", "checkmate", "cru-l1-ambitious-dream-station", "dudley-daughters", "levski",
    "lorville", "new-babbage", "nyx-gateway", "orison", "port-tressler", "pyro-gateway",
    "ruin-station", "seraphim-station", "terra-gateway",
];

/// Sync UEX : /terminals + /commodities_prices_all → tables UexTerminal / UexCommodityPrice,
/// avec mapping terminal → WikiStarmapLocation (wikiUuid) pour les distances en repli.
/// Garde-fou anti-écrasement par vide (comme nos autres syncs).
#[tauri::command]
pub async fn sync_uex_prices(app: AppHandle) -> Result<UexSyncReport, String> {
    let mut report = UexSyncReport::default();
    report.hubs_total = AUDIT_HUB_SLUGS.len() as i64;
    let client = uex_client()?;

    // ── Fetch (hors verrou DB) ──
    let terminals = get_data(&client, "terminals").await?;
    let prices = get_data(&client, "commodities_prices_all").await?;
    if terminals.is_empty() || prices.is_empty() {
        return Err("UEX : terminals ou prix vides — cache conservé".into());
    }

    // ── Index WikiStarmapLocation pour le mapping (sous verrou court) ──
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // norm(name|slug) → (uuid, slug)
    let mut wiki_idx: HashMap<String, (String, String)> = HashMap::new();
    for r in sqlx::query("SELECT uuid, slug, name FROM WikiStarmapLocation")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        let slug: Option<String> = r.try_get::<Option<String>, _>("slug").ok().flatten();
        let name: Option<String> = r.try_get::<Option<String>, _>("name").ok().flatten();
        if uuid.is_empty() {
            continue;
        }
        if let Some(s) = &slug {
            wiki_idx.entry(norm(s)).or_insert((uuid.clone(), s.clone()));
        }
        if let Some(n) = &name {
            let s = slug.clone().unwrap_or_default();
            wiki_idx.entry(norm(n)).or_insert((uuid.clone(), s));
        }
    }

    // ── Construit les lignes terminaux (+ mapping wiki) ──
    struct TermRow {
        id: i64,
        name: Option<String>,
        nickname: Option<String>,
        code: Option<String>,
        type_: Option<String>,
        system: Option<String>,
        planet: Option<String>,
        orbit: Option<String>,
        moon: Option<String>,
        station: Option<String>,
        outpost: Option<String>,
        city: Option<String>,
        id_city: Option<i64>,
        id_station: Option<i64>,
        display: String,
        wiki_uuid: Option<String>,
        wiki_slug: Option<String>,
    }

    let mut unmapped_log: Vec<String> = Vec::new();
    let mut term_rows: Vec<TermRow> = Vec::new();
    for t in &terminals {
        let Some(id) = vi64(t, "id") else { continue };
        let station = vstr(t, "space_station_name");
        let city = vstr(t, "city_name");
        let outpost = vstr(t, "outpost_name");
        let nickname = vstr(t, "nickname");
        let name = vstr(t, "name");
        // Meilleur nom lisible : station > ville > outpost > nickname > name.
        let display = station.clone().or_else(|| city.clone()).or_else(|| outpost.clone())
            .or_else(|| nickname.clone()).or_else(|| name.clone()).unwrap_or_default();

        // Mapping wiki : tester les noms physiques dans l'ordre.
        let mut wiki_uuid = None;
        let mut wiki_slug = None;
        'cand: for cand in [&station, &city, &outpost, &nickname, &name].into_iter().flatten() {
            // Essai direct, puis sans suffixe parenthésé (ex. "… (Stanton)").
            for key in [norm(cand), norm(&strip_paren(cand))] {
                if key.is_empty() {
                    continue;
                }
                if let Some((u, s)) = wiki_idx.get(&key) {
                    wiki_uuid = Some(u.clone());
                    wiki_slug = Some(s.clone());
                    break 'cand;
                }
            }
        }
        let type_ = vstr(t, "type");
        // Ne loguer "non mappé" que pour les terminaux de commerce (les seuls qui comptent).
        if wiki_uuid.is_none() && type_.as_deref() == Some("commodity") {
            unmapped_log.push(format!("{} (id {id})", display));
        }
        term_rows.push(TermRow {
            id,
            name,
            nickname,
            code: vstr(t, "code"),
            type_,
            system: vstr(t, "star_system_name"),
            planet: vstr(t, "planet_name"),
            orbit: vstr(t, "orbit_name"),
            moon: vstr(t, "moon_name"),
            station,
            outpost,
            city,
            id_city: vi64(t, "id_city"),
            id_station: vi64(t, "id_space_station"),
            display,
            wiki_uuid,
            wiki_slug,
        });
    }
    report.terminals = term_rows.len() as i64;
    report.commodity_terminals = term_rows.iter().filter(|t| t.type_.as_deref() == Some("commodity")).count() as i64;
    report.terminals_mapped = term_rows.iter().filter(|t| t.wiki_uuid.is_some()).count() as i64;
    report.terminals_unmapped =
        term_rows.iter().filter(|t| t.wiki_uuid.is_none() && t.type_.as_deref() == Some("commodity")).count() as i64;

    // ── Écriture transactionnelle (clear-then-recreate) ──
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM UexTerminal").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM UexCommodityPrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for t in &term_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO UexTerminal
               (id, name, nickname, code, type, systemName, planetName, orbitName, moonName,
                spaceStationName, outpostName, cityName, idCity, idSpaceStation, displayName,
                wikiUuid, wikiSlug, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(t.id)
        .bind(&t.name)
        .bind(&t.nickname)
        .bind(&t.code)
        .bind(&t.type_)
        .bind(&t.system)
        .bind(&t.planet)
        .bind(&t.orbit)
        .bind(&t.moon)
        .bind(&t.station)
        .bind(&t.outpost)
        .bind(&t.city)
        .bind(t.id_city)
        .bind(t.id_station)
        .bind(&t.display)
        .bind(&t.wiki_uuid)
        .bind(&t.wiki_slug)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let mut n_prices = 0i64;
    for p in &prices {
        let Some(id) = vi64(p, "id") else { continue };
        sqlx::query(
            "INSERT OR REPLACE INTO UexCommodityPrice
               (id, idCommodity, commodityName, idTerminal,
                priceBuy, priceBuyAvg, scuBuy, scuBuyAvg,
                priceSell, priceSellAvg, scuSellStock, scuSellStockAvg,
                statusBuy, statusSell, dateModified, timestampIso, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     strftime('%Y-%m-%dT%H:%M:%SZ', ?, 'unixepoch'), datetime('now'))",
        )
        .bind(id)
        .bind(vi64(p, "id_commodity"))
        .bind(vstr(p, "commodity_name"))
        .bind(vi64(p, "id_terminal"))
        .bind(vf64(p, "price_buy"))
        .bind(vf64(p, "price_buy_avg"))
        .bind(vf64(p, "scu_buy"))
        .bind(vf64(p, "scu_buy_avg"))
        .bind(vf64(p, "price_sell"))
        .bind(vf64(p, "price_sell_avg"))
        .bind(vf64(p, "scu_sell_stock"))
        .bind(vf64(p, "scu_sell_stock_avg"))
        .bind(vi64(p, "status_buy"))
        .bind(vi64(p, "status_sell"))
        .bind(vi64(p, "date_modified"))
        .bind(vi64(p, "date_modified"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n_prices += 1;
    }
    report.prices = n_prices;
    tx.commit().await.map_err(|e| e.to_string())?;

    // Contrôle hubs : combien des 14 slugs sont la cible d'au moins un terminal mappé.
    let mut hub_hits = 0i64;
    for slug in AUDIT_HUB_SLUGS {
        let row = sqlx::query("SELECT 1 FROM UexTerminal WHERE wikiSlug = ? LIMIT 1")
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if row.is_some() {
            hub_hits += 1;
        }
    }
    report.hubs_matched = hub_hits;

    if !unmapped_log.is_empty() {
        let mut s: Vec<&String> = unmapped_log.iter().collect();
        s.sort();
        eprintln!(
            "[uex] {} terminal(aux) de commerce NON mappés à WikiStarmapLocation : {}",
            unmapped_log.len(),
            s.iter().take(30).map(|x| x.as_str()).collect::<Vec<_>>().join(" | ")
        );
    }
    eprintln!(
        "[uex] SYNC — terminaux {} (commerce {}, mappés {}, non {}) | prix {} | hubs {}/{}",
        report.terminals, report.commodity_terminals, report.terminals_mapped,
        report.terminals_unmapped, report.prices, report.hubs_matched, report.hubs_total,
    );
    Ok(report)
}

/// État du cache UEX : lignes, fraîcheur, terminaux, couverture demande/stock.
#[tauri::command]
pub async fn get_uex_prices_status(db_instances: tauri::State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let agg = sqlx::query(
        "SELECT COUNT(*) AS rows,
                COUNT(DISTINCT idTerminal) AS terms,
                MIN(timestampIso) AS oldest,
                MAX(timestampIso) AS freshest,
                SUM(CASE WHEN priceBuy>0 THEN 1 ELSE 0 END) AS buys,
                SUM(CASE WHEN priceSell>0 THEN 1 ELSE 0 END) AS sells,
                SUM(CASE WHEN priceSell>0 AND scuSellStock>0 THEN 1 ELSE 0 END) AS sells_with_demand
           FROM UexCommodityPrice",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mapped = sqlx::query("SELECT COUNT(*) AS c FROM UexTerminal WHERE wikiUuid IS NOT NULL")
        .fetch_one(pool)
        .await
        .ok()
        .and_then(|r| r.try_get::<i64, _>("c").ok())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "rows": agg.try_get::<i64, _>("rows").unwrap_or(0),
        "terminals": agg.try_get::<i64, _>("terms").unwrap_or(0),
        "terminalsMapped": mapped,
        "oldestTimestamp": agg.try_get::<Option<String>, _>("oldest").ok().flatten(),
        "freshestTimestamp": agg.try_get::<Option<String>, _>("freshest").ok().flatten(),
        "buyPoints": agg.try_get::<i64, _>("buys").unwrap_or(0),
        "sellPoints": agg.try_get::<i64, _>("sells").unwrap_or(0),
        "sellPointsWithDemand": agg.try_get::<i64, _>("sells_with_demand").unwrap_or(0),
    }))
}
