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
    let mut cat_meta: HashMap<i64, (Option<String>, Option<String>, Option<String>)> = HashMap::new();
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

/* ═══════════════════════════ SYNC 2 — marché vaisseaux ═══════════════════════════ */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VehicleSyncReport {
    pub purchase_points: i64,
    pub rental_points: i64,
    pub vehicles_purchase: i64,
    pub vehicles_rental: i64,
}

/// Sync UEX : /vehicles (noms) + /vehicles_purchases_prices + /vehicles_rentals_prices →
/// peuple VehiclePurchasePrice / VehicleRentalPrice (aUEC in-game, géolocalisés).
#[tauri::command]
pub async fn sync_vehicle_marketplace(app: AppHandle) -> Result<VehicleSyncReport, String> {
    let mut report = VehicleSyncReport::default();
    let client = uex_client()?;

    let vehicles = get_data(&client, "vehicles").await?;
    let purchases = get_data(&client, "vehicles_purchases_prices").await?;
    let rentals = get_data(&client, "vehicles_rentals_prices").await?;
    if vehicles.is_empty() || (purchases.is_empty() && rentals.is_empty()) {
        return Err("UEX vaisseaux : données vides — tables conservées".into());
    }

    // id_vehicle → nom lisible (les endpoints prix ne portent que l'id).
    let mut veh_name: HashMap<i64, String> = HashMap::new();
    for v in &vehicles {
        if let (Some(id), Some(name)) = (vi64(v, "id"), vstr(v, "name_full").or_else(|| vstr(v, "name"))) {
            veh_name.insert(id, name);
        }
    }
    let name_of = |id: Option<i64>| -> Option<String> { id.and_then(|i| veh_name.get(&i).cloned()) };

    let mut pv: HashSet<i64> = HashSet::new();
    let mut rv: HashSet<i64> = HashSet::new();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM VehiclePurchasePrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM VehicleRentalPrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for p in &purchases {
        let Some(id) = vi64(p, "id") else { continue };
        let id_vehicle = vi64(p, "id_vehicle");
        if let Some(v) = id_vehicle {
            pv.insert(v);
        }
        sqlx::query(
            "INSERT OR REPLACE INTO VehiclePurchasePrice
               (id, idVehicle, vehicleName, idTerminal, terminalName, priceBuy,
                starSystemName, planetName, orbitName, moonName, cityName, outpostName,
                spaceStationName, dateModified, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(id_vehicle)
        .bind(name_of(id_vehicle))
        .bind(vi64(p, "id_terminal"))
        .bind(vstr(p, "terminal_name"))
        .bind(vf64(p, "price_buy"))
        .bind(vstr(p, "star_system_name"))
        .bind(vstr(p, "planet_name"))
        .bind(vstr(p, "orbit_name"))
        .bind(vstr(p, "moon_name"))
        .bind(vstr(p, "city_name"))
        .bind(vstr(p, "outpost_name"))
        .bind(vstr(p, "space_station_name"))
        .bind(vi64(p, "date_modified"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.purchase_points += 1;
    }

    for r in &rentals {
        let Some(id) = vi64(r, "id") else { continue };
        let id_vehicle = vi64(r, "id_vehicle");
        if let Some(v) = id_vehicle {
            rv.insert(v);
        }
        sqlx::query(
            "INSERT OR REPLACE INTO VehicleRentalPrice
               (id, idVehicle, vehicleName, idTerminal, terminalName, priceRent,
                starSystemName, planetName, orbitName, moonName, cityName, outpostName,
                spaceStationName, dateModified, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(id_vehicle)
        .bind(name_of(id_vehicle))
        .bind(vi64(r, "id_terminal"))
        .bind(vstr(r, "terminal_name"))
        .bind(vf64(r, "price_rent"))
        .bind(vstr(r, "star_system_name"))
        .bind(vstr(r, "planet_name"))
        .bind(vstr(r, "orbit_name"))
        .bind(vstr(r, "moon_name"))
        .bind(vstr(r, "city_name"))
        .bind(vstr(r, "outpost_name"))
        .bind(vstr(r, "space_station_name"))
        .bind(vi64(r, "date_modified"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.rental_points += 1;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    report.vehicles_purchase = pv.len() as i64;
    report.vehicles_rental = rv.len() as i64;
    eprintln!(
        "[catalog] VAISSEAUX — achat {} pts ({} vaisseaux) | location {} pts ({} vaisseaux)",
        report.purchase_points, report.vehicles_purchase, report.rental_points, report.vehicles_rental
    );
    Ok(report)
}

/* ═══════════════════════════ COMMANDES D'EXPOSITION (lot 2) ═══════════════════════ */

/// Taxonomie items pour les filtres : sections (principal) → sous-catégories.
#[tauri::command]
pub async fn get_item_categories(db_instances: tauri::State<'_, DbInstances>) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    // On ne liste que les (section, sous-catégorie) qui portent réellement des items vendus.
    let rows = sqlx::query(
        "SELECT DISTINCT i.section AS section, i.category AS category
           FROM Item i
          WHERE i.section IS NOT NULL AND i.section <> ''
          ORDER BY i.section, i.category",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut by_section: Vec<(String, Vec<String>)> = Vec::new();
    for r in &rows {
        let section: String = r.try_get::<Option<String>, _>("section").ok().flatten().unwrap_or_default();
        let category: Option<String> = r.try_get::<Option<String>, _>("category").ok().flatten();
        if let Some((s, cats)) = by_section.last_mut() {
            if *s == section {
                if let Some(c) = category {
                    if !cats.contains(&c) {
                        cats.push(c);
                    }
                }
                continue;
            }
        }
        by_section.push((section, category.into_iter().collect()));
    }
    Ok(json!(by_section
        .into_iter()
        .map(|(section, categories)| json!({ "section": section, "categories": categories }))
        .collect::<Vec<_>>()))
}

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
                i.idVehicle, i.vehicleName, i.urlStore,
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

/// Liste des vaisseaux du catalogue (jointure ShipData) + flags achat/location dispo.
#[tauri::command]
pub async fn get_catalog_vehicles(
    role: Option<String>,
    availability: Option<String>, // "purchase" | "rental" | "both" | None
    search: Option<String>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let mut sql = String::from(
        "WITH veh AS (
            SELECT idVehicle, vehicleName FROM VehiclePurchasePrice
            UNION SELECT idVehicle, vehicleName FROM VehicleRentalPrice
         )
         SELECT v.idVehicle AS idVehicle, v.vehicleName AS vehicleName,
            EXISTS(SELECT 1 FROM VehiclePurchasePrice p WHERE p.idVehicle = v.idVehicle) AS hasPurchase,
            EXISTS(SELECT 1 FROM VehicleRentalPrice r WHERE r.idVehicle = v.idVehicle) AS hasRental,
            (SELECT MIN(priceBuy) FROM VehiclePurchasePrice p WHERE p.idVehicle = v.idVehicle) AS minBuy,
            (SELECT MIN(priceRent) FROM VehicleRentalPrice r WHERE r.idVehicle = v.idVehicle) AS minRent,
            s.manufacturer AS manufacturer, s.role AS role, s.classification AS classification,
            s.cargoScu AS cargoScu, s.imageUrl AS imageUrl, s.size AS size, s.priceUec AS priceUec
         FROM (SELECT DISTINCT idVehicle, vehicleName FROM veh) v
         LEFT JOIN ShipData s ON s.name = v.vehicleName COLLATE NOCASE
            OR s.nameLocalized = v.vehicleName COLLATE NOCASE
         WHERE 1=1",
    );
    let role = role.filter(|s| !s.is_empty());
    let search = search.filter(|s| !s.trim().is_empty());
    let avail = availability.filter(|s| !s.is_empty());
    if role.is_some() {
        sql.push_str(" AND s.role = ?");
    }
    if search.is_some() {
        sql.push_str(" AND v.vehicleName LIKE ?");
    }
    match avail.as_deref() {
        Some("purchase") => sql.push_str(" AND EXISTS(SELECT 1 FROM VehiclePurchasePrice p WHERE p.idVehicle = v.idVehicle)"),
        Some("rental") => sql.push_str(" AND EXISTS(SELECT 1 FROM VehicleRentalPrice r WHERE r.idVehicle = v.idVehicle)"),
        Some("both") => sql.push_str(
            " AND EXISTS(SELECT 1 FROM VehiclePurchasePrice p WHERE p.idVehicle = v.idVehicle)
              AND EXISTS(SELECT 1 FROM VehicleRentalPrice r WHERE r.idVehicle = v.idVehicle)",
        ),
        _ => {}
    }
    sql.push_str(" ORDER BY v.vehicleName COLLATE NOCASE");

    let mut q = sqlx::query(&sql);
    if let Some(r) = &role {
        q = q.bind(r);
    }
    if let Some(s) = &search {
        q = q.bind(format!("%{s}%"));
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "idVehicle": r.try_get::<Option<i64>, _>("idVehicle").ok().flatten(),
                "vehicleName": r.try_get::<Option<String>, _>("vehicleName").ok().flatten(),
                "hasPurchase": r.try_get::<i64, _>("hasPurchase").unwrap_or(0) != 0,
                "hasRental": r.try_get::<i64, _>("hasRental").unwrap_or(0) != 0,
                "minBuy": r.try_get::<Option<f64>, _>("minBuy").ok().flatten(),
                "minRent": r.try_get::<Option<f64>, _>("minRent").ok().flatten(),
                "manufacturer": r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
                "role": r.try_get::<Option<String>, _>("role").ok().flatten(),
                "classification": r.try_get::<Option<String>, _>("classification").ok().flatten(),
                "cargoScu": r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
                "imageUrl": r.try_get::<Option<String>, _>("imageUrl").ok().flatten(),
                "size": r.try_get::<Option<String>, _>("size").ok().flatten(),
                "priceUec": r.try_get::<Option<f64>, _>("priceUec").ok().flatten(),
            })
        })
        .collect())
}

/// Marché d'un vaisseau : points d'ACHAT + points de LOCATION (terminal + lieu + aUEC).
#[tauri::command]
pub async fn get_vehicle_marketplace(
    id_vehicle: Option<i64>,
    vehicle_name: Option<String>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    let by_id = id_vehicle.is_some();
    if !by_id && vehicle_name.as_deref().unwrap_or("").is_empty() {
        return Err("get_vehicle_marketplace : id_vehicle ou vehicle_name requis".into());
    }
    let where_clause = if by_id { "idVehicle = ?" } else { "vehicleName = ? COLLATE NOCASE" };

    let cols = "terminalName, starSystemName, planetName, moonName, cityName, outpostName,
                spaceStationName, dateModified";

    let psql = format!("SELECT priceBuy, {cols} FROM VehiclePurchasePrice WHERE {where_clause} ORDER BY priceBuy ASC");
    let pq = sqlx::query(&psql);
    let pq = if by_id { pq.bind(id_vehicle) } else { pq.bind(vehicle_name.clone()) };
    let purchases = pq.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let rsql = format!("SELECT priceRent, {cols} FROM VehicleRentalPrice WHERE {where_clause} ORDER BY priceRent ASC");
    let rq = sqlx::query(&rsql);
    let rq = if by_id { rq.bind(id_vehicle) } else { rq.bind(vehicle_name.clone()) };
    let rentals = rq.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let row_json = |r: &sqlx::sqlite::SqliteRow, price_col: &str| -> Value {
        json!({
            "price": r.try_get::<Option<f64>, _>(price_col).ok().flatten(),
            "terminalName": r.try_get::<Option<String>, _>("terminalName").ok().flatten(),
            "systemName": r.try_get::<Option<String>, _>("starSystemName").ok().flatten(),
            "planetName": r.try_get::<Option<String>, _>("planetName").ok().flatten(),
            "moonName": r.try_get::<Option<String>, _>("moonName").ok().flatten(),
            "cityName": r.try_get::<Option<String>, _>("cityName").ok().flatten(),
            "outpostName": r.try_get::<Option<String>, _>("outpostName").ok().flatten(),
            "spaceStationName": r.try_get::<Option<String>, _>("spaceStationName").ok().flatten(),
            "dateModified": r.try_get::<Option<i64>, _>("dateModified").ok().flatten(),
        })
    };

    Ok(json!({
        "purchase": purchases.iter().map(|r| row_json(r, "priceBuy")).collect::<Vec<_>>(),
        "rental": rentals.iter().map(|r| row_json(r, "priceRent")).collect::<Vec<_>>(),
    }))
}
