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
