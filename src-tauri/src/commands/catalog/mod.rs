// Module Catalogue — items vendus in-game + vaisseaux (achat/location). Lecture publique
// UEX (api.uexcorp.uk, sans token). Géolocalisation via UexTerminal (déjà en base) ; specs
// vaisseaux via ShipData. Descriptif/stats Wiki = lazy au lot 2 (pas ici).

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Pool, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const UEX_BASE: &str = "https://api.uexcorp.uk/2.0";
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";
const REQUEST_TIMEOUT_SECS: u64 = 90;
const RATE_LIMIT_DELAY_MS: u64 = 80;

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

fn vstr(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
fn vi64(v: &Value, k: &str) -> Option<i64> {
    // UEX renvoie parfois les nombres en chaîne ("1") → tolérer les deux.
    v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}
fn vf64(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

/* ═══════════════════════════ COMMANDES D'EXPOSITION (lot 2) ═══════════════════════ */

/// Liste filtrée d'items (+ nb de points de vente) pour le panneau gauche « Achetable ».
#[tauri::command]
pub async fn get_catalog_items(
    section: Option<String>,
    category: Option<String>,
    search: Option<String>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let mut sql = String::from(
        "SELECT i.id, i.uuid, i.name, i.slug, i.section, i.category, i.companyName, i.size,
                i.idVehicle, i.vehicleName, i.urlStore, i.imageUrl,
                (SELECT COUNT(*) FROM ItemPrice p WHERE p.idItem = i.id AND p.priceBuy > 0) AS sellPoints,
                (SELECT MIN(p.priceBuy) FROM ItemPrice p WHERE p.idItem = i.id AND p.priceBuy > 0) AS minPrice
           FROM Item i WHERE 1=1",
    );
    let sec = section.filter(|s| !s.is_empty());
    let cat = category.filter(|s| !s.is_empty());
    let search = search.filter(|s| !s.trim().is_empty());
    if sec.is_some() {
        sql.push_str(" AND i.section = ?");
    }
    if cat.is_some() {
        sql.push_str(" AND i.category = ?");
    }
    if search.is_some() {
        sql.push_str(" AND i.name LIKE ?");
    }
    sql.push_str(" ORDER BY i.name COLLATE NOCASE");

    let mut q = sqlx::query(&sql);
    if let Some(s) = &sec {
        q = q.bind(s);
    }
    if let Some(c) = &cat {
        q = q.bind(c);
    }
    if let Some(s) = &search {
        q = q.bind(format!("%{s}%"));
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<i64, _>("id").unwrap_or_default(),
                "uuid": r.try_get::<Option<String>, _>("uuid").ok().flatten(),
                "name": r.try_get::<Option<String>, _>("name").ok().flatten(),
                "slug": r.try_get::<Option<String>, _>("slug").ok().flatten(),
                "section": r.try_get::<Option<String>, _>("section").ok().flatten(),
                "category": r.try_get::<Option<String>, _>("category").ok().flatten(),
                "companyName": r.try_get::<Option<String>, _>("companyName").ok().flatten(),
                "size": r.try_get::<Option<String>, _>("size").ok().flatten(),
                "idVehicle": r.try_get::<Option<i64>, _>("idVehicle").ok().flatten(),
                "vehicleName": r.try_get::<Option<String>, _>("vehicleName").ok().flatten(),
                "urlStore": r.try_get::<Option<String>, _>("urlStore").ok().flatten(),
                "imageUrl": r.try_get::<Option<String>, _>("imageUrl").ok().flatten(),
                "sellPoints": r.try_get::<i64, _>("sellPoints").unwrap_or(0),
                "minPrice": r.try_get::<Option<f64>, _>("minPrice").ok().flatten(),
            })
        })
        .collect())
}

/// Points de vente d'un item (magasin + lieu via UexTerminal + prix aUEC), triés par prix.
#[tauri::command]
pub async fn get_item_purchase_points(
    id_item: Option<i64>,
    uuid: Option<String>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let base = "SELECT p.priceBuy AS priceBuy, p.terminalName AS terminalName, p.dateModified AS dateModified,
                       t.displayName AS displayName, t.systemName AS systemName, t.planetName AS planetName,
                       t.moonName AS moonName, t.cityName AS cityName, t.spaceStationName AS spaceStationName,
                       t.outpostName AS outpostName
                  FROM ItemPrice p
                  LEFT JOIN UexTerminal t ON t.id = p.idTerminal
                 WHERE p.priceBuy > 0 AND ";
    let rows = if let Some(id) = id_item {
        sqlx::query(&format!("{base} p.idItem = ? ORDER BY p.priceBuy ASC")).bind(id).fetch_all(pool).await
    } else if let Some(u) = uuid.filter(|s| !s.is_empty()) {
        sqlx::query(&format!("{base} p.itemUuid = ? ORDER BY p.priceBuy ASC")).bind(u).fetch_all(pool).await
    } else {
        return Err("get_item_purchase_points : id_item ou uuid requis".into());
    }
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "priceBuy": r.try_get::<Option<f64>, _>("priceBuy").ok().flatten(),
                "terminalName": r.try_get::<Option<String>, _>("terminalName").ok().flatten(),
                "shopName": r.try_get::<Option<String>, _>("displayName").ok().flatten(),
                "systemName": r.try_get::<Option<String>, _>("systemName").ok().flatten(),
                "planetName": r.try_get::<Option<String>, _>("planetName").ok().flatten(),
                "moonName": r.try_get::<Option<String>, _>("moonName").ok().flatten(),
                "cityName": r.try_get::<Option<String>, _>("cityName").ok().flatten(),
                "spaceStationName": r.try_get::<Option<String>, _>("spaceStationName").ok().flatten(),
                "outpostName": r.try_get::<Option<String>, _>("outpostName").ok().flatten(),
                "dateModified": r.try_get::<Option<i64>, _>("dateModified").ok().flatten(),
            })
        })
        .collect())
}

/* ═══════════════════════ VUE PAR LIEU (Item Finder inverse) ═══════════════════════ */

/// Terminaux qui VENDENT des items (priceBuy>0), avec lieu, nb d'items distincts et prix
/// mini + fraîcheur (dateModified le plus récent). Triés par système puis nom de magasin.
#[tauri::command]
pub async fn get_catalog_terminals(
    search: Option<String>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let mut sql = String::from(
        "SELECT p.idTerminal AS idTerminal,
                COALESCE(NULLIF(t.name, ''), NULLIF(t.nickname, ''), NULLIF(t.displayName, ''), p.terminalName) AS terminalName,
                t.systemName AS systemName, t.planetName AS planetName, t.moonName AS moonName,
                t.cityName AS cityName, t.spaceStationName AS spaceStationName, t.outpostName AS outpostName,
                COUNT(DISTINCT p.idItem) AS itemCount,
                MIN(p.priceBuy) AS minPrice,
                MAX(p.dateModified) AS lastModified
           FROM ItemPrice p
           LEFT JOIN UexTerminal t ON t.id = p.idTerminal
          WHERE p.priceBuy > 0 AND p.idTerminal IS NOT NULL",
    );
    let search = search.filter(|s| !s.trim().is_empty());
    if search.is_some() {
        sql.push_str(" AND (t.name LIKE ? OR t.nickname LIKE ? OR t.displayName LIKE ? OR p.terminalName LIKE ?)");
    }
    sql.push_str(" GROUP BY p.idTerminal ORDER BY t.systemName, terminalName COLLATE NOCASE");

    let mut q = sqlx::query(&sql);
    if let Some(s) = &search {
        let like = format!("%{s}%");
        q = q.bind(like.clone()).bind(like.clone()).bind(like.clone()).bind(like);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "idTerminal": r.try_get::<Option<i64>, _>("idTerminal").ok().flatten(),
                "terminalName": r.try_get::<Option<String>, _>("terminalName").ok().flatten(),
                "systemName": r.try_get::<Option<String>, _>("systemName").ok().flatten(),
                "planetName": r.try_get::<Option<String>, _>("planetName").ok().flatten(),
                "moonName": r.try_get::<Option<String>, _>("moonName").ok().flatten(),
                "cityName": r.try_get::<Option<String>, _>("cityName").ok().flatten(),
                "spaceStationName": r.try_get::<Option<String>, _>("spaceStationName").ok().flatten(),
                "outpostName": r.try_get::<Option<String>, _>("outpostName").ok().flatten(),
                "itemCount": r.try_get::<i64, _>("itemCount").unwrap_or(0),
                "minPrice": r.try_get::<Option<f64>, _>("minPrice").ok().flatten(),
                "lastModified": r.try_get::<Option<i64>, _>("lastModified").ok().flatten(),
            })
        })
        .collect())
}

/// Items vendus à un terminal donné (priceBuy>0) + prix + fraîcheur + section/catégorie
/// (via Item), triés par prix croissant. Alimente le panneau droit de la vue par lieu.
#[tauri::command]
pub async fn get_terminal_items(
    id_terminal: i64,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let rows = sqlx::query(
        "SELECT p.idItem AS idItem, p.itemUuid AS itemUuid, p.itemName AS itemName,
                p.priceBuy AS priceBuy, p.dateModified AS dateModified,
                i.section AS section, i.category AS category, i.companyName AS companyName,
                i.size AS size, i.imageUrl AS imageUrl
           FROM ItemPrice p
           LEFT JOIN Item i ON i.id = p.idItem
          WHERE p.idTerminal = ? AND p.priceBuy > 0
          ORDER BY p.priceBuy ASC",
    )
    .bind(id_terminal)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "idItem": r.try_get::<Option<i64>, _>("idItem").ok().flatten(),
                "uuid": r.try_get::<Option<String>, _>("itemUuid").ok().flatten(),
                "name": r.try_get::<Option<String>, _>("itemName").ok().flatten(),
                "priceBuy": r.try_get::<Option<f64>, _>("priceBuy").ok().flatten(),
                "dateModified": r.try_get::<Option<i64>, _>("dateModified").ok().flatten(),
                "section": r.try_get::<Option<String>, _>("section").ok().flatten(),
                "category": r.try_get::<Option<String>, _>("category").ok().flatten(),
                "companyName": r.try_get::<Option<String>, _>("companyName").ok().flatten(),
                "size": r.try_get::<Option<String>, _>("size").ok().flatten(),
                "imageUrl": r.try_get::<Option<String>, _>("imageUrl").ok().flatten(),
            })
        })
        .collect())
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
pub(crate) mod sync_items;
pub(crate) mod sync_vehicles;
pub(crate) mod wiki;
