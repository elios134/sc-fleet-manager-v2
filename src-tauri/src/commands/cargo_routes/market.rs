// Chargement du marché en mémoire (étapes 1-4 du moteur), partagé single-hop / boucle.

use super::*;

/// Marché chargé en mémoire (étapes 1-4 du moteur) : partagé entre le single-hop et le
/// planificateur de boucle. Owned → le verrou DB est relâché après chargement.
pub(crate) struct Market {
    pub(crate) cargo_scu: Option<i64>,
    pub(crate) qt_speed: Option<f64>,
    pub(crate) qt_spool: Option<f64>,
    pub(crate) qt_a1: Option<f64>,
    pub(crate) qt_a2: Option<f64>,
    pub(crate) qt_tt10: Option<f64>,
    pub(crate) qt_resolved: bool,
    pub(crate) qt_ramp: bool,
    pub(crate) spool: f64,
    /// Conso du drive quantique stock en SCU/Gm (coût carburant par leg). None si non synchro.
    pub(crate) qt_fuel_per_gm: Option<f64>,
    /// Capacité du réservoir de carburant quantique (SCU). None si non synchro.
    pub(crate) quantum_fuel_scu: Option<f64>,
    /// Autonomie max du vaisseau en Gm (pré-calculée par l'API Wiki). None si non synchro.
    pub(crate) quantum_range_gm: Option<f64>,
    pub(crate) buy_points: std::collections::HashMap<String, Vec<PricePoint>>,
    pub(crate) sell_points: std::collections::HashMap<String, Vec<PricePoint>>,
    pub(crate) pos: std::collections::HashMap<String, Pos>,
    pub(crate) graph: std::collections::HashMap<String, Vec<(String, String, String)>>,
    pub(crate) slug_uuid: std::collections::HashMap<String, String>,
    pub(crate) slug_name: std::collections::HashMap<String, String>,
    pub(crate) price_points_dropped_band: i64,
    pub(crate) price_points_dropped_stale: i64,
}

/// Charge le marché (vaisseau + prix filtrés + positions + sauts). Lecture 100 % base.
pub(crate) async fn load_market(app: &AppHandle, ship_name: &str) -> Result<Market, String> {
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
