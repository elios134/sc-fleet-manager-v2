// Moteur profit / temps des routes cargo : marché, distances, filtres qualité, calcul des routes.
use super::*;

/* ════════════ Phase C' (1/2) — MOTEUR de calcul profit/temps (backend) ═══════════ */
// Routes A→B simples (maxStops=1) : achat (boutique SELLS) → revente (boutique BUYS).
// Socle = marge brute (toujours calculable). Couche distance/temps PAR-DESSUS, ISOLÉE :
// si une position manque, la route reste (profitPerMinute=null), jamais de crash.
//
// MODÈLE DE TEMPS RÉALISTE (proche de SC Wiki routePlanner.js) :
//   timeSec = HANDLING_FORFAIT + Σ_legs( spool + tempsTrajetRampe(distance) )
//   • tempsTrajetRampe = rampe d'accélération a1→a2 → vmax → décélération (portage exact
//     de estimateTravelTime ; calibré sur travel_time_10gm). Repli vmax-only si a1/a2
//     absents, puis tt10-linéaire, sinon pas de temps (marge brute).
//   • Plus de plancher arbitraire : le forfait chargement/déchargement joue ce rôle.
//   • Stats QT = drive QUANTUM STOCK du vaisseau (ShipHardpoint→Component).
// HYPOTHÈSE QUANTITÉ : `quantity` <= 0 (ou NULL) du flux de prix = « non renseigné » →
//   PAS de contrainte de stock. Seules les quantités strictement positives bornent.
// CARBURANT : laissé à plus tard (fuel=null).

/* ── Constantes ajustables : filtres qualité + modèle de temps + fraîcheur ── */

/// (1) Cap de ratio de marge : rejette une route si sellPrice/buyPrice dépasse ce facteur.
/// Resserré à 5× (audit : aucune marge légitime observée > ~4×, 5× garde une marge de
/// sécurité ; au-delà = scan aberrant).
pub(crate) const MAX_MARGIN_RATIO: f64 = 5.0;

/// (2) Bande de prix autour de la MÉDIANE par marchandise : écarte > FACTEUR×médiane ou
/// < médiane/FACTEUR. 5× garde la variabilité légitime, coupe les scans absurdes.
pub(crate) const MEDIAN_BAND_FACTOR: f64 = 5.0;

/// (3) Forfait chargement/déchargement (secondes), fixe par route : modélise le temps de
/// freight elevator / QCS aux deux extrémités. Remplace l'ancien plancher 2 min.
/// Valeur plausible et AJUSTABLE (à calibrer sur des temps SC Trade Tools observés).
pub(crate) const HANDLING_FORFAIT_SEC: f64 = 120.0;

/// (4) Cap de FRAÎCHEUR : on écarte les lignes de prix plus vieilles que N jours
/// (le flux crowdsource peut contenir des scans d'il y a plusieurs semaines).
pub(crate) const MAX_PRICE_AGE_DAYS: i64 = 14;

/// (5) Seuil de distance fiable (mètres) = 0,01 Gm. Sous ce seuil, entre deux lieux de
/// NOMS DIFFÉRENTS, la position fine manque (avant-postes ~collés retombant sur ~la même
/// position) → distance NON fiable → traitée comme INCONNUE (pas de temps/profit-min,
/// affichée "—", route conservée en marge brute). UEX lui-même affiche N/A pour ces cas.
pub(crate) const EPSILON_DISTANCE_M: f64 = 1.0e7;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoRoute {
    pub commodity: String,
    pub from_location: String,
    pub to_location: String,
    pub from_name: Option<String>,
    pub to_name: Option<String>,
    pub from_uuid: Option<String>,
    pub to_uuid: Option<String>,
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
    pub price_timestamp: Option<String>,
    pub fuel: Option<f64>,
    /// Carburant quantique consommé par ce leg (SCU) = distanceGm × conso drive (SCU/Gm).
    /// None si l'autonomie n'est pas synchronisée pour ce vaisseau.
    pub fuel_scu: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRoutesResult {
    pub ship_name: String,
    pub cargo_scu: Option<i64>,
    pub qt_drive_speed: Option<f64>,
    pub qt_spool_time: Option<f64>,
    pub qt_resolved: bool,
    pub qt_ramp: bool,
    pub investment: f64,
    pub routes_considered: i64,
    pub routes_with_time: i64,
    pub price_points_dropped_band: i64,
    pub price_points_dropped_stale: i64,
    pub pairs_dropped_ratio: i64,
    pub routes: Vec<CargoRoute>,
    pub note: String,
}

#[derive(Clone)]
pub(crate) struct Pos {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub system: Option<String>,
}

#[derive(Clone)]
pub(crate) struct PricePoint {
    pub(crate) location: String,
    pub(crate) slug: Option<String>,
    pub(crate) price: f64,
    pub(crate) quantity: Option<i64>,
    pub(crate) timestamp: Option<String>,
    /// Stock COURANT brut (scuBuy pour l'achat / scuSellStock pour la vente). Sert au flag
    /// rupture (=0) et à l'affluence estimée. NON replié sur la moyenne (≠ `quantity`).
    pub(crate) stock_cur: Option<i64>,
    /// Stock MOYEN historique (scuBuyAvg / scuSellStockAvg) — référence de l'affluence.
    pub(crate) stock_avg: Option<i64>,
    /// Statut d'inventaire UEX (0–7 ; 0/1 = épuisé/très bas).
    pub(crate) status: Option<i64>,
}

pub(crate) fn euclid(a: &Pos, b: &Pos) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Distance achat→vente en mètres + nb de legs quantiques.
///   • même système → euclidien direct (1 leg).
///   • systèmes différents → enchaînement via les jump points (BFS sur le graphe de
///     systèmes). None si une position de porte manque → route en marge brute (sans temps).
pub(crate) fn route_distance(
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

/* ── Modèle de temps QT : fonctions pures extraites dans commands::travel_physics ── */

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

/// Cœur du moteur : lit tout en mémoire (sous le verrou DB), puis calcule à froid.
pub(crate) async fn find_cargo_routes_core(
    app: &AppHandle,
    ship_name: String,
    investment: f64,
    system: Option<String>,
    limit: i64,
) -> Result<FindRoutesResult, String> {
    let Market {
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
        quantum_fuel_scu: _,
        quantum_range_gm: _,
        buy_points,
        sell_points,
        pos,
        graph,
        slug_uuid,
        slug_name,
        price_points_dropped_band,
        price_points_dropped_stale,
    } = load_market(app, &ship_name).await?;

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
                        // Distance fiable uniquement au-dessus du seuil epsilon. En dessous
                        // (deux lieux distincts ~collés = position fine manquante), on traite
                        // comme DISTANCE INCONNUE : pas de distance/temps/profit-min (route
                        // conservée, triée par profit brut comme le fallback).
                        if dist_m >= EPSILON_DISTANCE_M {
                            distance_gm = Some(dist_m / 1.0e9);
                            jumps = Some(legs - 1);
                            if qt_resolved {
                                // Temps RÉALISTE : forfait chargement + spool×legs + rampe accel.
                                if let Some(travel) = qt_travel_seconds(dist_m, qt_speed, qt_a1, qt_a2, qt_tt10) {
                                    let time_sec = HANDLING_FORFAIT_SEC + spool * legs as f64 + travel;
                                    let tm = time_sec / 60.0;
                                    time_minutes = Some(tm);
                                    if tm > 0.0 {
                                        profit_per_minute = Some(profit / tm);
                                    }
                                }
                            }
                        }
                    }
                }

                // Fraîcheur de la route = la plus VIEILLE des deux lignes de prix (limitante).
                let price_timestamp = match (&bp.timestamp, &sp.timestamp) {
                    (Some(a), Some(b)) => Some(a.min(b).clone()),
                    (Some(a), None) => Some(a.clone()),
                    (None, Some(b)) => Some(b.clone()),
                    (None, None) => None,
                };

                routes.push(CargoRoute {
                    commodity: commodity.clone(),
                    from_location: bp.location.clone(),
                    to_location: sp.location.clone(),
                    from_name: readable(&bp.slug, &bp.location),
                    to_name: readable(&sp.slug, &sp.location),
                    from_uuid: bp.slug.as_ref().and_then(|s| slug_uuid.get(s)).cloned(),
                    to_uuid: sp.slug.as_ref().and_then(|s| slug_uuid.get(s)).cloned(),
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
                    price_timestamp,
                    fuel: None,
                    fuel_scu: distance_gm.zip(qt_fuel_per_gm).map(|(d, f)| d * f),
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
        "Temps = forfait {}s + spool×legs + {}. Quantité bornée par budget{}, stock>0. \
         Fraîcheur ≤ {} j. Carburant différé.{}{}",
        HANDLING_FORFAIT_SEC as i64,
        if qt_ramp { "rampe accel (a1/a2)" } else { "vitesse max (a1/a2 non synchronisés → re-sync composants)" },
        if cargo_scu.is_some() { " + cargoScu" } else { " (cargoScu inconnu → non borné)" },
        MAX_PRICE_AGE_DAYS,
        if qt_resolved { "" } else { " Drive QT non résolu → profit/min indisponible (marge brute)." },
        if pos.is_empty() { " Table positions vide → marge brute pure." } else { "" },
    );

    eprintln!(
        "[cargo_routes] ROUTES {} (budget {:.0}) — {} routes ({} avec temps, rampe={}) | filtres: bande -{}, périmé -{}, ratio>{}× -{}",
        ship_name,
        investment,
        routes_considered,
        routes_with_time,
        qt_ramp,
        price_points_dropped_band,
        price_points_dropped_stale,
        MAX_MARGIN_RATIO,
        pairs_dropped_ratio,
    );

    Ok(FindRoutesResult {
        ship_name,
        cargo_scu,
        qt_drive_speed: qt_speed,
        qt_spool_time: qt_spool,
        qt_resolved,
        qt_ramp,
        investment,
        routes_considered,
        routes_with_time,
        price_points_dropped_band,
        price_points_dropped_stale,
        pairs_dropped_ratio,
        routes,
        note,
    })
}
