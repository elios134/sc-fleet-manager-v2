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

use crate::DB_URL;
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

/* ───────────────────── Loadout minage (UEX cat 28/29/30) ─────────────────────
   Tetes laser (29), modules (30), gadgets (28) + leurs attributs (stats) + prix.
   Construit la donnee structuree lue par la page Loadout minage (calcul cote
   front). Mise en cache dans AppMeta ; rafraichie depuis UEX si perimee (>14 j).
   Donnees = faits de jeu via l'API publique UEX ; code original (clean-room). */
const MINING_MAX_AGE_SECS: u64 = 14 * 24 * 3600;

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
async fn meta_get(pool: &Pool<Sqlite>, key: &str) -> Option<String> {
    crate::commands::app_meta::get(pool, key).await
}
async fn meta_set(pool: &Pool<Sqlite>, key: &str, value: &str) -> Result<(), String> {
    crate::commands::app_meta::set(pool, key, value).await
}

/// f64 depuis un champ JSON nombre OU chaine (UEX renvoie parfois des chaines).
fn jf64(v: &Value, k: &str) -> Option<f64> {
    match v.get(k) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.replace('%', "").replace(',', "").trim().parse().ok(),
        _ => None,
    }
}
/// f64 depuis une chaine d'attribut.
fn anum_str(s: &str) -> Option<f64> {
    s.replace('%', "").replace(',', "").trim().parse::<f64>().ok()
}
/// "900 - 3600" -> (900, 3600) ; valeur seule -> (v, v).
fn parse_power(s: &str) -> (f64, f64) {
    let t = s.trim();
    if let Some((i, _)) = t.match_indices(" - ").next() {
        let a = &t[..i];
        let b = &t[i + 3..];
        if let (Ok(x), Ok(y)) = (a.trim().parse::<f64>(), b.trim().parse::<f64>()) {
            return (x, y);
        }
    }
    let v = t.parse::<f64>().unwrap_or(0.0);
    (v, v)
}
fn attr_map(rows: &[Value]) -> HashMap<i64, HashMap<String, String>> {
    let mut m: HashMap<i64, HashMap<String, String>> = HashMap::new();
    for r in rows {
        let id = r.get("id_item").and_then(|v| v.as_i64());
        let name = r.get("attribute_name").and_then(|v| v.as_str());
        if let (Some(id), Some(name)) = (id, name) {
            let val = match r.get("value") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                _ => String::new(),
            };
            m.entry(id).or_default().insert(name.to_string(), val);
        }
    }
    m
}
type PriceMaps = (HashMap<i64, f64>, HashMap<i64, Vec<(String, f64)>>);
fn price_map(rows: &[Value]) -> PriceMaps {
    let mut mn: HashMap<i64, f64> = HashMap::new();
    let mut loc: HashMap<i64, Vec<(String, f64)>> = HashMap::new();
    for r in rows {
        let Some(id) = r.get("id_item").and_then(|v| v.as_i64()) else { continue };
        let buy = jf64(r, "price_buy").unwrap_or(0.0);
        if buy <= 0.0 {
            continue;
        }
        let e = mn.entry(id).or_insert(buy);
        if buy < *e {
            *e = buy;
        }
        let term = r.get("terminal_name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if !term.is_empty() {
            loc.entry(id).or_default().push((term, buy));
        }
    }
    for v in loc.values_mut() {
        v.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    }
    (mn, loc)
}
/// Liste "ou acheter" (<=6 terminaux les moins chers) au format JSON.
fn buy_list(loc: &HashMap<i64, Vec<(String, f64)>>, id: i64) -> Value {
    let v: Vec<Value> = loc
        .get(&id)
        .map(|l| l.iter().take(6).map(|(t, p)| serde_json::json!({"terminal": t, "price": p})).collect())
        .unwrap_or_default();
    Value::Array(v)
}
fn aget<'a>(a: &'a HashMap<String, String>, k: &str) -> Option<&'a String> {
    a.get(k)
}
fn anum(a: &HashMap<String, String>, k: &str) -> Option<f64> {
    a.get(k).and_then(|s| anum_str(s))
}

/// Construit la donnee loadout (lasers/modules/gadgets) depuis l'API UEX.
async fn build_mining_loadout(client: &reqwest::Client) -> Result<Value, String> {
    // Tetes laser (cat 29)
    let l_items = get_data(client, "items/id_category/29").await?;
    let l_attr = attr_map(&get_data(client, "items_attributes/id_category/29").await?);
    let (l_mn, l_loc) = price_map(&get_data(client, "items_prices/id_category/29").await?);
    let lasers: Vec<Value> = l_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = l_attr.get(&id).cloned().unwrap_or_default();
            let (mnp, mxp) = parse_power(aget(&a, "Mining Laser Power").map(String::as_str).unwrap_or(""));
            Some(serde_json::json!({
                "name": name,
                "company": r.get("company_name").and_then(|v| v.as_str()).unwrap_or(""),
                "size": jf64(r, "size").or_else(|| anum(&a, "Size")).unwrap_or(0.0) as i64,
                "minPower": mnp, "maxPower": mxp,
                "extPower": anum(&a, "Extraction Laser Power"),
                "optRange": anum(&a, "Optimal Range"),
                "maxRange": anum(&a, "Maximum Range"),
                "resistance": anum(&a, "Resistance"),
                "instability": anum(&a, "Laser Instability"),
                "inert": anum(&a, "Inert Material Level"),
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "chargeRate": anum(&a, "Optimal Charge Window Rate"),
                "moduleSlots": anum(&a, "Module Slots").map(|v| v.round() as i64).unwrap_or(2),
                "price": l_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&l_loc, id),
            }))
        })
        .collect();

    // Modules (cat 30)
    let m_items = get_data(client, "items/id_category/30").await?;
    let m_attr = attr_map(&get_data(client, "items_attributes/id_category/30").await?);
    let (m_mn, m_loc) = price_map(&get_data(client, "items_prices/id_category/30").await?);
    let modules: Vec<Value> = m_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = m_attr.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "type": aget(&a, "Item Type").map(|s| s.trim().to_string()).unwrap_or_else(|| "Passive".into()),
                "powerPct": anum(&a, "Mining Laser Power"),
                "extPowerPct": anum(&a, "Extraction Laser Power"),
                "resistance": anum(&a, "Resistance"),
                "instability": anum(&a, "Laser Instability"),
                "inert": anum(&a, "Inert Material Level"),
                "chargeRate": anum(&a, "Optimal Charge Rate"),
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "overcharge": anum(&a, "Catastrophic Charge Rate"),
                "shatter": anum(&a, "Shatter Damage"),
                "uses": anum(&a, "Uses").map(|v| v.round() as i64).unwrap_or(0),
                "duration": anum(&a, "Duration"),
                "price": m_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&m_loc, id),
            }))
        })
        .collect();

    // Gadgets (cat 28)
    let g_items = get_data(client, "items/id_category/28").await?;
    let g_attr = attr_map(&get_data(client, "items_attributes/id_category/28").await?);
    let (g_mn, g_loc) = price_map(&get_data(client, "items_prices/id_category/28").await?);
    let gadgets: Vec<Value> = g_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = g_attr.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "chargeRate": anum(&a, "Optimal Charge Window Rate"),
                "instability": anum(&a, "Laser Instability"),
                "resistance": anum(&a, "Resistance"),
                "cluster": anum(&a, "Cluster Modifier"),
                "price": g_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&g_loc, id),
            }))
        })
        .collect();

    Ok(serde_json::json!({
        "generatedUnix": now_unix(),
        "lasers": lasers,
        "modules": modules,
        "gadgets": gadgets,
    }))
}

/// Donnee loadout minage : cache AppMeta, rafraichie depuis UEX si perimee (>14 j)
/// ou absente. En cas d'echec reseau, renvoie le cache existant s'il y en a un.
#[tauri::command]
pub async fn get_mining_loadout(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool = pool_from!(lock);

    let cached = meta_get(pool, "mining.loadoutData").await;
    let synced: u64 = meta_get(pool, "mining.loadoutSyncedAt")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let fresh = cached.is_some() && now_unix().saturating_sub(synced) < MINING_MAX_AGE_SECS;
    if fresh {
        if let Some(c) = &cached {
            if let Ok(v) = serde_json::from_str::<Value>(c) {
                return Ok(v);
            }
        }
    }

    let client = uex_client()?;
    match build_mining_loadout(&client).await {
        Ok(data) => {
            let s = data.to_string();
            let _ = meta_set(pool, "mining.loadoutData", &s).await;
            let _ = meta_set(pool, "mining.loadoutSyncedAt", &now_unix().to_string()).await;
            Ok(data)
        }
        Err(e) => {
            if let Some(c) = cached {
                if let Ok(v) = serde_json::from_str::<Value>(&c) {
                    return Ok(v);
                }
            }
            Err(e)
        }
    }
}

/// Construit la donnee salvage (modules scraper, cat 31) depuis l'API UEX.
async fn build_salvage_loadout(client: &reqwest::Client) -> Result<Value, String> {
    let items = get_data(client, "items/id_category/31").await?;
    let attrs = attr_map(&get_data(client, "items_attributes/id_category/31").await?);
    let (mn, loc) = price_map(&get_data(client, "items_prices/id_category/31").await?);
    let heads: Vec<Value> = items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = attrs.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "company": r.get("company_name").and_then(|v| v.as_str()).unwrap_or(""),
                "size": jf64(r, "size").or_else(|| anum(&a, "Size")).unwrap_or(0.0) as i64,
                "extractionSpeed": anum(&a, "Extraction Speed"),
                "radius": anum(&a, "Radius"),
                "efficiency": anum(&a, "Extraction Efficiency"),
                "price": mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&loc, id),
            }))
        })
        .collect();
    Ok(serde_json::json!({ "generatedUnix": now_unix(), "heads": heads }))
}

/// Donnee salvage : meme cache/repli que get_mining_loadout (rafraichi >14 j).
#[tauri::command]
pub async fn get_salvage_loadout(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool = pool_from!(lock);

    let cached = meta_get(pool, "salvage.loadoutData").await;
    let synced: u64 = meta_get(pool, "salvage.loadoutSyncedAt")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if cached.is_some() && now_unix().saturating_sub(synced) < MINING_MAX_AGE_SECS {
        if let Some(c) = &cached {
            if let Ok(v) = serde_json::from_str::<Value>(c) {
                return Ok(v);
            }
        }
    }

    let client = uex_client()?;
    match build_salvage_loadout(&client).await {
        Ok(data) => {
            let s = data.to_string();
            let _ = meta_set(pool, "salvage.loadoutData", &s).await;
            let _ = meta_set(pool, "salvage.loadoutSyncedAt", &now_unix().to_string()).await;
            Ok(data)
        }
        Err(e) => {
            if let Some(c) = cached {
                if let Ok(v) = serde_json::from_str::<Value>(&c) {
                    return Ok(v);
                }
            }
            Err(e)
        }
    }
}
