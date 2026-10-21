// Catalogue CCU en ligne (index ccu-data) : synchro, alertes de la liste de souhaits, tâche de fond.
use super::*;

/* ─────────────────────── sync_ccu_from_index (catalogue en ligne) ─────────────────────── */

/// URL de l'index CCU partagé (repo `ccu-data`, MAJ hebdo). Même modèle que l'index 3D :
/// fetch tolérant (absent/injoignable → no-op signalé, jamais bloquant), cache-bust.
pub(crate) const CCU_INDEX_URL: &str = "https://raw.githubusercontent.com/elios134/ccu-data/main/ccu-index.json";

/// Charge le catalogue CCU depuis l'index en ligne (SKUs + upgrades + noms), disponible pour
/// TOUS les users sans synchro RSI. Upsert `source = 'online'`. L'index porte lui-même la
/// disponibilité (`available:false` pour les ships retirés, prix historique conservé) → les
/// vaisseaux plus en vente restent planifiables. Le scrape RSI perso reste un overlay optionnel.
#[tauri::command]
pub async fn sync_ccu_from_index(app: tauri::AppHandle, db_instances: State<'_, DbInstances>) -> Result<Value, String> {
    // Pool cloné (Arc interne) → pas de verrou DbInstances tenu pendant la transaction.
    let pool: sqlx::SqlitePool = {
        let instances = db_instances.0.read().await;
        match instances
            .get(DB_URL)
            .ok_or_else(|| format!("Base non chargée : {DB_URL}"))?
        {
            DbPool::Sqlite(p) => p.clone(),
            #[allow(unreachable_patterns)]
            _ => return Err("Connexion SQLite attendue".into()),
        }
    };
    sync_ccu_index_core(&app, pool).await
}

/// Synchro de l'index CCU (commande et tâche de fond) + alertes de la liste de souhaits.
pub async fn sync_ccu_index_core(app: &tauri::AppHandle, pool: sqlx::SqlitePool) -> Result<Value, String> {
    let cb = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let url = format!("{CCU_INDEX_URL}?cb={cb}");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    // Fetch tolérant : toute erreur réseau/HTTP → no-op signalé (l'app garde ses données).
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return Ok(json!({ "ok": false, "reason": e.to_string() })),
    };
    if !resp.status().is_success() {
        return Ok(json!({ "ok": false, "reason": format!("HTTP {}", resp.status()) }));
    }
    let idx: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return Ok(json!({ "ok": false, "reason": e.to_string() })),
    };

    let ships = idx.get("ships").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let skus = idx.get("skus").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let upgrades = idx.get("upgrades").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let generated_at = idx.get("generatedAt").and_then(|v| v.as_str()).map(String::from);

    // État des vaisseaux souhaités AVANT la mise à jour (comparé après, pour les alertes).
    let before = crate::commands::wishlist::wishlist_states(&pool).await;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut names_count = 0i64;
    let mut sku_count = 0i64;
    let mut upgrade_count = 0i64;

    // Noms canoniques (jointure vaisseaux).
    for s in &ships {
        let id = match s.get("shipId").and_then(|v| v.as_i64()) {
            Some(v) => v,
            None => continue,
        };
        let name = match s.get("name").and_then(|v| v.as_str()) {
            Some(v) => v,
            None => continue,
        };
        sqlx::query(
            "INSERT INTO RsiShipName (shipId, name, updatedAt) VALUES (?, ?, datetime('now'))
             ON CONFLICT(shipId) DO UPDATE SET name = excluded.name, updatedAt = datetime('now')",
        )
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        names_count += 1;
    }

    // SKUs AVANT les upgrades (FK CcuUpgrade.toSkuId → CcuSku.skuId).
    for sk in &skus {
        let sku_id = match sk.get("skuId").and_then(|v| v.as_i64()) {
            Some(v) => v,
            None => continue,
        };
        let ship_id = sk.get("shipId").and_then(|v| v.as_i64()).unwrap_or(0);
        let price = sk.get("priceCents").and_then(|v| v.as_i64()).unwrap_or(0);
        let available = sk.get("available").and_then(|v| v.as_bool()).unwrap_or(false) as i64;
        let unlimited = sk.get("unlimitedStock").and_then(|v| v.as_bool()).unwrap_or(false) as i64;
        let stock: Option<i64> = sk.get("availableStock").and_then(|v| v.as_i64());
        sqlx::query(
            "INSERT INTO CcuSku (skuId, shipId, priceCents, available, unlimitedStock, availableStock, source, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 'online', datetime('now'))
             ON CONFLICT(skuId) DO UPDATE SET
               shipId = excluded.shipId, priceCents = excluded.priceCents, available = excluded.available,
               unlimitedStock = excluded.unlimitedStock, availableStock = excluded.availableStock,
               source = 'online', updatedAt = datetime('now')",
        )
        .bind(sku_id)
        .bind(ship_id)
        .bind(price)
        .bind(available)
        .bind(unlimited)
        .bind(stock)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sku_count += 1;
    }

    // Arêtes d'upgrade (from → toSku).
    for u in &upgrades {
        let from_id = match u.get("fromShipId").and_then(|v| v.as_i64()) {
            Some(v) => v,
            None => continue,
        };
        let to_sku = match u.get("toSkuId").and_then(|v| v.as_i64()) {
            Some(v) => v,
            None => continue,
        };
        let price = u.get("upgradePriceCents").and_then(|v| v.as_i64()).unwrap_or(0);
        sqlx::query(
            "INSERT INTO CcuUpgrade (fromShipId, toSkuId, upgradePriceCents, source, updatedAt)
             VALUES (?, ?, ?, 'online', datetime('now'))
             ON CONFLICT(fromShipId, toSkuId) DO UPDATE SET
               upgradePriceCents = excluded.upgradePriceCents, source = 'online', updatedAt = datetime('now')",
        )
        .bind(from_id)
        .bind(to_sku)
        .bind(price)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        upgrade_count += 1;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    // Horodatage du catalogue en ligne (= generatedAt de l'index, sinon epoch-ms courant).
    let stamp = generated_at.clone().unwrap_or_else(|| format!("epoch:{cb}"));
    let _ = sqlx::query(
        "INSERT INTO AppMeta (key, value) VALUES ('ccu.lastOnlineSyncAt', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&stamp)
    .execute(&pool)
    .await;

    crate::commands::wishlist::notify_wishlist_changes(app, &pool, &before).await;

    Ok(json!({
        "ok": true,
        "ships": names_count,
        "skus": sku_count,
        "upgrades": upgrade_count,
        "generatedAt": generated_at,
    }))
}

/// Tâche de fond : synchro de l'index CCU au lancement puis toutes les 6 h, pour que les
/// alertes de la liste de souhaits partent sans ouvrir l'onglet CCU. Attend que la base soit
/// ouverte par le front. Best-effort (index absent / hors-ligne → on réessaie au tour suivant).
pub fn spawn_ccu_sync(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        loop {
            let pool = loop {
                let found = {
                    let instances = app.state::<DbInstances>();
                    let lock = instances.0.read().await;
                    match lock.get(DB_URL) {
                        Some(DbPool::Sqlite(p)) => Some(p.clone()),
                        _ => None,
                    }
                };
                match found {
                    Some(p) => break p,
                    None => tokio::time::sleep(Duration::from_secs(15)).await,
                }
            };
            if let Err(e) = sync_ccu_index_core(&app, pool).await {
                eprintln!("[ccu] synchro de fond échouée : {e}");
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}
