// Synchro UEX du catalogue d'objets (catégories, prix d'achat, métadonnées).
use super::*;

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
