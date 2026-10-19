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

/* ════════════════════════════ SYNC 1 — catalogue items ════════════════════════════ */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSyncReport {
    pub categories: i64,
    pub items: i64,
    pub prices: i64,
    pub errors: Vec<String>,
}

/// Sync UEX : /categories + /items_prices_all + /items (par catégorie présente) →
/// peuple ItemCategory / Item / ItemPrice. Ne garde que les items VENDUS (≥1 price_buy>0).
#[tauri::command]
pub async fn sync_item_catalog(app: AppHandle) -> Result<CatalogSyncReport, String> {
    let mut report = CatalogSyncReport::default();
    let client = uex_client()?;

    // ── Fetch (hors verrou DB) ──
    let categories = get_data(&client, "categories").await?;
    let prices = get_data(&client, "items_prices_all").await?;
    if categories.is_empty() || prices.is_empty() {
        return Err("UEX catalogue : categories ou prix vides — tables conservées".into());
    }

    // Map id_category → (section, name, type) pour dénormaliser.
    type CatMeta = (Option<String>, Option<String>, Option<String>);
    let mut cat_meta: HashMap<i64, CatMeta> = HashMap::new();
    for c in &categories {
        if let Some(id) = vi64(c, "id") {
            cat_meta.insert(id, (vstr(c, "section"), vstr(c, "name"), vstr(c, "type")));
        }
    }

    // Lignes de prix d'ACHAT (price_buy>0) → ItemPrice + ensembles items/catégories vendus.
    struct PriceRow {
        id: i64,
        id_item: i64,
        uuid: Option<String>,
        name: Option<String>,
        id_category: Option<i64>,
        id_terminal: Option<i64>,
        terminal_name: Option<String>,
        price_buy: f64,
        price_sell: Option<f64>,
        date_modified: Option<i64>,
    }
    let mut price_rows: Vec<PriceRow> = Vec::new();
    let mut sold_items: HashSet<i64> = HashSet::new();
    let mut sold_categories: HashSet<i64> = HashSet::new();
    for p in &prices {
        let Some(id) = vi64(p, "id") else { continue };
        let Some(id_item) = vi64(p, "id_item") else { continue };
        let buy = vf64(p, "price_buy").unwrap_or(0.0);
        if buy <= 0.0 {
            continue; // "où acheter" = points d'achat uniquement
        }
        let id_category = vi64(p, "id_category");
        sold_items.insert(id_item);
        if let Some(c) = id_category {
            sold_categories.insert(c);
        }
        price_rows.push(PriceRow {
            id,
            id_item,
            uuid: vstr(p, "item_uuid"),
            name: vstr(p, "item_name"),
            id_category,
            id_terminal: vi64(p, "id_terminal"),
            terminal_name: vstr(p, "terminal_name"),
            price_buy: buy,
            price_sell: vf64(p, "price_sell"),
            date_modified: vi64(p, "date_modified"),
        });
    }

    // Métadonnées riches par item : fetch /items pour chaque catégorie VENDUE.
    struct ItemRow {
        id: i64,
        uuid: Option<String>,
        name: Option<String>,
        slug: Option<String>,
        id_category: Option<i64>,
        section: Option<String>,
        category: Option<String>,
        company_name: Option<String>,
        size: Option<String>,
        id_vehicle: Option<i64>,
        vehicle_name: Option<String>,
        url_store: Option<String>,
    }
    let mut item_meta: HashMap<i64, ItemRow> = HashMap::new();
    let mut cat_list: Vec<i64> = sold_categories.iter().copied().filter(|c| *c > 0).collect();
    cat_list.sort_unstable();
    for cid in cat_list {
        match get_data(&client, &format!("items?id_category={cid}")).await {
            Ok(items) => {
                for it in &items {
                    let Some(id) = vi64(it, "id") else { continue };
                    if !sold_items.contains(&id) {
                        continue;
                    }
                    item_meta.insert(
                        id,
                        ItemRow {
                            id,
                            uuid: vstr(it, "uuid"),
                            name: vstr(it, "name"),
                            slug: vstr(it, "slug"),
                            id_category: vi64(it, "id_category"),
                            section: vstr(it, "section"),
                            category: vstr(it, "category"),
                            company_name: vstr(it, "company_name"),
                            size: vstr(it, "size"),
                            id_vehicle: vi64(it, "id_vehicle").filter(|v| *v > 0),
                            vehicle_name: vstr(it, "vehicle_name"),
                            url_store: vstr(it, "url_store"),
                        },
                    );
                }
            }
            Err(e) => {
                if report.errors.len() < 20 {
                    report.errors.push(format!("items?id_category={cid} : {e}"));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // Repli : tout item vendu non couvert par /items → métadonnées minimales depuis le prix.
    let mut first_price: HashMap<i64, &PriceRow> = HashMap::new();
    for pr in &price_rows {
        first_price.entry(pr.id_item).or_insert(pr);
    }
    for id in &sold_items {
        if item_meta.contains_key(id) {
            continue;
        }
        if let Some(pr) = first_price.get(id) {
            let (section, category) = pr
                .id_category
                .and_then(|c| cat_meta.get(&c))
                .map(|(s, n, _)| (s.clone(), n.clone()))
                .unwrap_or((None, None));
            item_meta.insert(
                *id,
                ItemRow {
                    id: *id,
                    uuid: pr.uuid.clone(),
                    name: pr.name.clone(),
                    slug: None,
                    id_category: pr.id_category,
                    section,
                    category,
                    company_name: None,
                    size: None,
                    id_vehicle: None,
                    vehicle_name: None,
                    url_store: None,
                },
            );
        }
    }

    // ── Écriture transactionnelle (clear-then-recreate) ──
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ItemCategory").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM Item").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ItemPrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for c in &categories {
        let Some(id) = vi64(c, "id") else { continue };
        sqlx::query(
            "INSERT OR REPLACE INTO ItemCategory (id, type, section, name, isGameRelated, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(vstr(c, "type"))
        .bind(vstr(c, "section"))
        .bind(vstr(c, "name"))
        .bind(vi64(c, "is_game_related"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.categories += 1;
    }

    for it in item_meta.values() {
        sqlx::query(
            "INSERT OR REPLACE INTO Item
               (id, uuid, name, slug, idCategory, section, category, companyName, size,
                idVehicle, vehicleName, urlStore, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(it.id)
        .bind(&it.uuid)
        .bind(&it.name)
        .bind(&it.slug)
        .bind(it.id_category)
        .bind(&it.section)
        .bind(&it.category)
        .bind(&it.company_name)
        .bind(&it.size)
        .bind(it.id_vehicle)
        .bind(&it.vehicle_name)
        .bind(&it.url_store)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.items += 1;
    }

    for pr in &price_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO ItemPrice
               (id, idItem, itemUuid, itemName, idCategory, idTerminal, terminalName,
                priceBuy, priceSell, dateModified, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(pr.id)
        .bind(pr.id_item)
        .bind(&pr.uuid)
        .bind(&pr.name)
        .bind(pr.id_category)
        .bind(pr.id_terminal)
        .bind(&pr.terminal_name)
        .bind(pr.price_buy)
        .bind(pr.price_sell)
        .bind(pr.date_modified)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.prices += 1;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    eprintln!(
        "[catalog] ITEMS — catégories {} | items vendus {} | points de vente {} | erreurs {}",
        report.categories,
        report.items,
        report.prices,
        report.errors.len()
    );
    Ok(report)
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



/* ═════════════ DÉTAIL WIKI LAZY — descriptif + stats au clic (pas de bulk) ═════════ */

fn jstr(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
fn jnum(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}
/// Formate un nombre proprement (entier si rond).
fn numfmt(n: f64) -> String {
    if (n.fract()).abs() < 1e-9 {
        format!("{}", n as i64)
    } else {
        format!("{n:.1}")
    }
}

/// Détail d'un item depuis SC Wiki (`/api/v2/items/{uuid}`) : descriptif + meta + stats
/// normalisées (description_data + quelques stats combat typées). LAZY (appelé au clic).
/// Best-effort : renvoie un objet vide si l'uuid manque ou l'API échoue (jamais d'erreur dure).
#[tauri::command]
pub async fn get_item_wiki_detail(uuid: Option<String>) -> Result<Value, String> {
    let empty = json!({ "available": false, "description": null, "stats": [] });
    let Some(uuid) = uuid.filter(|s| !s.trim().is_empty()) else {
        return Ok(empty);
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("SCFleetManager/2.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(empty),
    };

    let resp = match client.get(format!("{WIKI_BASE}/items/{uuid}")).header("Accept", "application/json").send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(empty),
    };
    let json: Value = match resp.json().await {
        Ok(j) => j,
        Err(_) => return Ok(empty),
    };
    let it = json.get("data").unwrap_or(&json);

    // Descriptif : fr_FR sinon en_EN.
    let description = it
        .get("description")
        .and_then(|d| jstr(d, "fr_FR").or_else(|| jstr(d, "en_EN")));

    // Stats normalisées (liste {name,value}) : description_data (déjà adapté au type) +
    // quelques stats combat typées absentes de description_data.
    let mut stats: Vec<Value> = Vec::new();
    if let Some(dd) = it.get("description_data").and_then(|d| d.as_array()) {
        for e in dd {
            if let (Some(name), Some(value)) = (jstr(e, "name"), jstr(e, "value")) {
                stats.push(json!({ "name": name, "value": value }));
            }
        }
    }
    if let Some(w) = it.get("vehicle_weapon").filter(|v| v.is_object()) {
        if let Some(v) = jnum(w, "damage_per_shot") {
            stats.push(json!({ "name": "Damage / shot", "value": numfmt(v) }));
        }
        if let Some(v) = jnum(w, "rpm") {
            stats.push(json!({ "name": "Rate of fire", "value": format!("{} rpm", numfmt(v)) }));
        }
        if let Some(v) = jnum(w, "range") {
            stats.push(json!({ "name": "Range", "value": format!("{} m", numfmt(v)) }));
        }
    }
    if let Some(h) = it.get("durability").and_then(|d| jnum(d, "health")) {
        stats.push(json!({ "name": "Health", "value": numfmt(h) }));
    }

    // Image (bonus, souvent absente pour l'équipement fonctionnel) : images[0] en string
    // OU en objet {original_url|url}. Repli côté front sur l'icône de catégorie.
    let image = it
        .get("images")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|first| {
            first
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| jstr(first, "original_url").or_else(|| jstr(first, "url")))
        });

    Ok(json!({
        "available": true,
        "description": description,
        "manufacturer": it.get("manufacturer").and_then(|m| jstr(m, "name")).filter(|s| s != "Unknown"),
        "typeLabel": jstr(it, "type_label"),
        "subTypeLabel": jstr(it, "sub_type_label"),
        "size": it.get("size").and_then(|s| s.as_i64().or_else(|| s.as_str().and_then(|x| x.parse().ok()))),
        "grade": jstr(it, "grade"),
        "webUrl": jstr(it, "web_url"),
        "imageUrl": image,
        "stats": stats,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemImageSyncReport {
    pub pages: i64,
    pub with_image: i64,
    pub updated: i64,
}

/// Couverture complète des images d'objets : balaye SC Wiki /items (paginé), extrait
/// images[0] et l'écrit dans Item.imageUrl (jointure par uuid). Une seule passe (quelques
/// pages), best-effort par page. Beaucoup d'objets fonctionnels n'ont pas d'image → repli
/// icône côté UI.
#[tauri::command]
pub async fn sync_item_images(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<ItemImageSyncReport, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut map: Vec<(String, String)> = Vec::new(); // (uuid, imageUrl)
    let mut page = 1u32;
    let mut last_page = 1u32;
    let mut pages = 0i64;
    loop {
        let url = format!("{WIKI_BASE}/items?limit=100&page={page}");
        let json: Value = match client.get(&url).header("Accept", "application/json").send().await {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(j) => j,
                Err(_) => break,
            },
            _ => break,
        };
        pages += 1;
        if let Some(lp) = json.get("meta").and_then(|m| m.get("last_page")).and_then(|x| x.as_u64()) {
            last_page = lp as u32;
        }
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for it in arr {
                let Some(uuid) = jstr(it, "uuid") else { continue };
                let img = it
                    .get("images")
                    .and_then(|a| a.as_array())
                    .and_then(|a| a.first())
                    .and_then(|first| {
                        first
                            .as_str()
                            .map(|s| s.to_string())
                            .or_else(|| jstr(first, "original_url").or_else(|| jstr(first, "url")))
                    });
                if let Some(img) = img {
                    map.push((uuid, img));
                }
            }
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    let with_image = map.len() as i64;

    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut updated = 0i64;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (uuid, img) in &map {
        if let Ok(r) = sqlx::query("UPDATE Item SET imageUrl = ? WHERE uuid = ?")
            .bind(img)
            .bind(uuid)
            .execute(&mut *tx)
            .await
        {
            updated += r.rows_affected() as i64;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ItemImageSyncReport { pages, with_image, updated })
}
