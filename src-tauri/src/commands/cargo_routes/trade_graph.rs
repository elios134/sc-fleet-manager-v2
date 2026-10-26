// Commande GPS trading : graphe complet (legs par carrefour, achetable par lieu, positions).

use super::*;

/// Commande GPS trading : renvoie le graphe complet (legs par carrefour + achetable@lieu +
/// positions) pour un vaisseau. Réutilise load_market + build_legs (mêmes filtres/caveats
/// que le single-hop et la boucle : fraîcheur ≤ 14 j, bande médiane, stock/demande).
#[tauri::command]
pub async fn get_trade_graph(
    app: AppHandle,
    ship_name: String,
    system: Option<String>,
) -> Result<TradeGraph, String> {
    use std::collections::HashMap;

    let m = load_market(&app, &ship_name).await?;
    let sys_filter = system.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let legs_static = build_legs(&m, sys_filter);

    // Quantité « pleine cargaison » par leg : plafond statique sinon capacité du vaisseau.
    let full_qty = |l: &LegStatic| -> i64 {
        if l.cargo_cap == i64::MAX {
            m.cargo_scu.filter(|c| *c > 0).unwrap_or(1)
        } else {
            l.cargo_cap
        }
    };

    let mut legs_from: HashMap<String, Vec<GpsLeg>> = HashMap::new();
    for (k, legs) in &legs_static {
        // Dédoublonnage par (denrée, destination) : si un lieu a plusieurs terminaux
        // d'achat d'une même denrée (ex. Lorville CBD + L19), garde le MEILLEUR profit
        // vers une destination donnée → pas de destination répétée dans "Autres reventes".
        let mut best: HashMap<(String, String), GpsLeg> = HashMap::new();
        for l in legs {
            let leg = GpsLeg {
                route: leg_to_route(l, full_qty(l)),
                from_key: l.from_key.clone(),
                to_key: l.to_key.clone(),
                affluence: l.affluence.clone(),
            };
            let dk = (leg.route.commodity.clone(), leg.to_key.clone());
            match best.get(&dk) {
                Some(prev) if prev.route.profit >= leg.route.profit => {}
                _ => {
                    best.insert(dk, leg);
                }
            }
        }
        // Tri « meilleure revente d'abord » : profit/min décroissant (timées en tête),
        // sinon profit brut — mêmes critères que le moteur.
        let mut out: Vec<GpsLeg> = best.into_values().collect();
        out.sort_by(|a, b| match (a.route.profit_per_minute, b.route.profit_per_minute) {
            (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.route.profit.partial_cmp(&a.route.profit).unwrap_or(std::cmp::Ordering::Equal),
        });
        legs_from.insert(k.clone(), out);
    }

    // Denrées TRADABLES par lieu = celles ayant au moins une revente rentable (≥ 1 leg).
    // Sert à masquer du carrefour GPS les denrées sans marché (munitions/consommables) ou
    // en perte (carburants), sans toucher au stock (la rupture reste affichée, pas masquée).
    let mut tradable: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    for (k, legs) in &legs_from {
        let set = tradable.entry(k.clone()).or_default();
        for l in legs {
            set.insert(l.route.commodity.clone());
        }
    }

    // Résout le système d'un lieu (via slug → uuid → position) pour le filtre éventuel.
    let key_system = |key: &str| -> Option<String> {
        m.slug_uuid.get(key).and_then(|u| m.pos.get(u)).and_then(|p| p.system.clone())
    };

    // Achetable@lieu : UNE entrée par denrée (Correctif 2a), restreinte aux denrées
    // TRADABLES (Correctif 1). Meilleur point d'achat = en stock d'abord, puis prix le
    // plus bas. Une denrée tradable en rupture est CONSERVÉE (affichée barrée), pas masquée.
    let mut best_buy: HashMap<(String, String), &PricePoint> = HashMap::new();
    for (commodity, buys) in &m.buy_points {
        for bp in buys {
            let key = bp.slug.clone().unwrap_or_else(|| bp.location.clone());
            if let Some(f) = sys_filter {
                if !key_system(&key).map(|s| s.eq_ignore_ascii_case(f)).unwrap_or(false) {
                    continue;
                }
            }
            // Masque les denrées sans revente rentable depuis ce lieu (0 leg).
            if !tradable.get(&key).map(|s| s.contains(commodity)).unwrap_or(false) {
                continue;
            }
            let dk = (key, commodity.clone());
            let better = match best_buy.get(&dk) {
                None => true,
                Some(prev) => {
                    let prev_oos = prev.stock_cur == Some(0);
                    let cur_oos = bp.stock_cur == Some(0);
                    if prev_oos != cur_oos {
                        !cur_oos // préfère un point en stock
                    } else {
                        bp.price < prev.price // sinon prix d'achat le plus bas
                    }
                }
            };
            if better {
                best_buy.insert(dk, bp);
            }
        }
    }
    let mut buyable_at: HashMap<String, Vec<GpsBuyItem>> = HashMap::new();
    for ((key, commodity), bp) in best_buy {
        buyable_at.entry(key).or_default().push(GpsBuyItem {
            commodity,
            buy_price: bp.price,
            stock: bp.stock_cur,
            status_buy: bp.status,
            out_of_stock: bp.stock_cur == Some(0),
        });
    }
    for v in buyable_at.values_mut() {
        v.sort_by_key(|a| a.commodity.to_lowercase());
    }

    // Positions (clé lieu → x/y/z) pour la carte du LOT 2.
    let mut positions: HashMap<String, GpsPos> = HashMap::new();
    for (key, uuid) in &m.slug_uuid {
        if let Some(p) = m.pos.get(uuid) {
            positions.insert(key.clone(), GpsPos { x: p.x, y: p.y, z: p.z, system: p.system.clone() });
        }
    }

    // Lieux de départ = ceux où l'on peut acheter, avec nom lisible, triés par nom.
    let mut locations: Vec<GpsLocation> = buyable_at
        .keys()
        .map(|k| GpsLocation {
            key: k.clone(),
            name: m.slug_name.get(k).cloned().unwrap_or_else(|| k.clone()),
            system: positions.get(k).and_then(|p| p.system.clone()),
        })
        .collect();
    locations.sort_by_key(|a| a.name.to_lowercase());

    eprintln!(
        "[cargo_routes] TRADE_GRAPH {} → {} carrefours, {} lieux achetables, {} positions",
        ship_name,
        legs_from.len(),
        buyable_at.len(),
        positions.len(),
    );

    Ok(TradeGraph {
        ship_name,
        cargo_scu: m.cargo_scu,
        qt_resolved: m.qt_resolved,
        quantum_range_gm: m.quantum_range_gm,
        quantum_fuel_scu: m.quantum_fuel_scu,
        legs_from,
        buyable_at,
        positions,
        locations,
    })
}
