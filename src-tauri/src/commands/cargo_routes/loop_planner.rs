// Planificateur de boucle cargo (chaînage glouton / beam des legs).
use super::*;

/* ════════════ Phase C' (2/2) — Planificateur de BOUCLE (chaînage glouton/beam) ════ */

/// Un « leg » statique (indépendant du budget) : acheter `commodity` au lieu `from` →
/// revendre au lieu `to`. Plafonds (cargo/stock/demande) et temps fixes ; la quantité
/// réelle dépend du budget courant, appliqué au moment du chaînage.
#[derive(Clone)]
pub(crate) struct LegStatic {
    pub(crate) commodity: String,
    pub(crate) from_key: String,
    pub(crate) to_key: String,
    pub(crate) from_location: String,
    pub(crate) to_location: String,
    pub(crate) from_name: Option<String>,
    pub(crate) to_name: Option<String>,
    pub(crate) from_uuid: Option<String>,
    pub(crate) to_uuid: Option<String>,
    pub(crate) from_system: Option<String>,
    pub(crate) to_system: Option<String>,
    pub(crate) buy_price: f64,
    pub(crate) sell_price: f64,
    pub(crate) margin_unit: f64,
    pub(crate) cargo_cap: i64, // min(cargoScu, stockAchat, demandeVente) ; i64::MAX si aucun plafond
    pub(crate) jumps: Option<i64>,
    pub(crate) distance_gm: Option<f64>,
    pub(crate) time_minutes: Option<f64>,
    /// Carburant quantique du leg (SCU) = distanceGm × conso drive (SCU/Gm). None si non synchro.
    pub(crate) fuel_scu: Option<f64>,
    pub(crate) price_timestamp: Option<String>,
    /// Affluence ESTIMÉE au point de vente : "low" | "medium" | "high" (proxy, pas un
    /// trafic réel — voir `affluence_level`).
    pub(crate) affluence: String,
}

/// AFFLUENCE ESTIMÉE (proxy HONNÊTE, PAS une mesure de trafic réel) au point de VENTE :
/// principalement le DÉFICIT de stock courant vs moyenne (demande déjà absorbée par
/// d'autres joueurs ⇒ route fréquentée), complété par le statut d'inventaire UEX.
/// Aucune API ne mesure la fréquentation directement → à présenter comme « estimée ».
pub(crate) fn affluence_level(p: &PricePoint) -> String {
    let mut score = 0i32;
    if let (Some(cur), Some(avg)) = (p.stock_cur, p.stock_avg) {
        if avg > 0 {
            let ratio = cur as f64 / avg as f64;
            if ratio < 0.34 {
                score += 2; // stock très en dessous de la moyenne = forte pression
            } else if ratio < 0.67 {
                score += 1;
            }
        }
    }
    if let Some(s) = p.status {
        if s <= 1 {
            score += 1; // inventaire épuisé/très bas = activité récente
        }
    }
    match score {
        s if s >= 2 => "high".to_string(),
        1 => "medium".to_string(),
        _ => "low".to_string(),
    }
}

/// Potentiel statique (profit/min à pleine cargaison) — heuristique de pré-tri du beam.
pub(crate) fn leg_potential(l: &LegStatic) -> f64 {
    let cap = if l.cargo_cap == i64::MAX { 1000 } else { l.cargo_cap } as f64;
    let p = l.margin_unit * cap;
    match l.time_minutes {
        Some(t) if t > 0.0 => p / t,
        _ => p,
    }
}

/// Quantité achetable pour un budget : min(⌊budget/prix⌋, plafond statique).
pub(crate) fn qty_for(l: &LegStatic, budget: f64) -> i64 {
    if l.buy_price <= 0.0 {
        return 0;
    }
    let by_budget = (budget / l.buy_price).floor() as i64;
    if l.cargo_cap == i64::MAX {
        by_budget.max(0)
    } else {
        by_budget.min(l.cargo_cap).max(0)
    }
}

/// Matérialise un leg en CargoRoute (MÊME struct que le single-hop → modale + soute
/// compatibles) pour une quantité donnée.
pub(crate) fn leg_to_route(l: &LegStatic, qty: i64) -> CargoRoute {
    let profit = l.margin_unit * qty as f64;
    let profit_per_minute = match l.time_minutes {
        Some(t) if t > 0.0 => Some(profit / t),
        _ => None,
    };
    CargoRoute {
        commodity: l.commodity.clone(),
        from_location: l.from_location.clone(),
        to_location: l.to_location.clone(),
        from_name: l.from_name.clone(),
        to_name: l.to_name.clone(),
        from_uuid: l.from_uuid.clone(),
        to_uuid: l.to_uuid.clone(),
        buy_price: l.buy_price,
        sell_price: l.sell_price,
        margin_unit: l.margin_unit,
        quantity_scu: qty,
        profit,
        from_system: l.from_system.clone(),
        to_system: l.to_system.clone(),
        jumps: l.jumps,
        distance_gm: l.distance_gm,
        time_minutes: l.time_minutes,
        profit_per_minute,
        price_timestamp: l.price_timestamp.clone(),
        fuel: None,
        fuel_scu: l.fuel_scu,
    }
}

/// Index des legs rentables par lieu d'ACHAT. Mêmes filtres que le single-hop (même lieu
/// exclu, ratio de marge), mais SANS bornage par l'investment (plafonds statiques).
pub(crate) fn build_legs(m: &Market, system_filter: Option<&str>) -> std::collections::HashMap<String, Vec<LegStatic>> {
    use std::collections::HashMap;
    let resolve_pos = |slug: &Option<String>| -> Option<(String, Pos)> {
        let s = slug.as_ref()?;
        let uuid = m.slug_uuid.get(s)?;
        let p = m.pos.get(uuid)?;
        Some((uuid.clone(), p.clone()))
    };
    let readable = |slug: &Option<String>, raw: &str| -> Option<String> {
        slug.as_ref()
            .and_then(|s| m.slug_name.get(s))
            .cloned()
            .or_else(|| Some(leaf_of(raw)))
    };

    let mut legs_from: HashMap<String, Vec<LegStatic>> = HashMap::new();
    for (commodity, buys) in &m.buy_points {
        let Some(sells) = m.sell_points.get(commodity) else { continue };
        for bp in buys {
            if bp.price <= 0.0 {
                continue;
            }
            for sp in sells {
                if sp.price <= bp.price {
                    continue;
                }
                let same_place = match (&bp.slug, &sp.slug) {
                    (Some(a), Some(b)) => a == b,
                    _ => bp.location == sp.location,
                };
                if same_place {
                    continue;
                }
                if sp.price / bp.price > MAX_MARGIN_RATIO {
                    continue;
                }
                let margin = sp.price - bp.price;
                let mut cap = i64::MAX;
                if let Some(c) = m.cargo_scu {
                    if c > 0 {
                        cap = cap.min(c);
                    }
                }
                if let Some(q) = bp.quantity {
                    if q > 0 {
                        cap = cap.min(q);
                    }
                }
                if let Some(q) = sp.quantity {
                    if q > 0 {
                        cap = cap.min(q);
                    }
                }
                if cap < 1 {
                    continue;
                }

                let from_res = resolve_pos(&bp.slug);
                let to_res = resolve_pos(&sp.slug);
                let from_system = from_res.as_ref().and_then(|(_, p)| p.system.clone());
                let to_system = to_res.as_ref().and_then(|(_, p)| p.system.clone());
                // Filtre système : confine la boucle au système choisi (legs partant de ce
                // système). Un leg sans système connu est écarté quand un filtre est actif.
                if let Some(f) = system_filter {
                    let ok = from_system.as_ref().map(|s| s.eq_ignore_ascii_case(f)).unwrap_or(false);
                    if !ok {
                        continue;
                    }
                }
                let mut distance_gm = None;
                let mut time_minutes = None;
                let mut jumps = None;
                if let (Some((bu, _)), Some((su, _))) = (&from_res, &to_res) {
                    if let Some((dist_m, legs)) = route_distance(bu, su, &m.pos, &m.graph) {
                        if dist_m >= EPSILON_DISTANCE_M {
                            distance_gm = Some(dist_m / 1.0e9);
                            jumps = Some(legs - 1);
                            if m.qt_resolved {
                                if let Some(travel) =
                                    qt_travel_seconds(dist_m, m.qt_speed, m.qt_a1, m.qt_a2, m.qt_tt10)
                                {
                                    let time_sec = HANDLING_FORFAIT_SEC + m.spool * legs as f64 + travel;
                                    time_minutes = Some(time_sec / 60.0);
                                }
                            }
                        }
                    }
                }
                let price_timestamp = match (&bp.timestamp, &sp.timestamp) {
                    (Some(a), Some(b)) => Some(a.min(b).clone()),
                    (Some(a), None) => Some(a.clone()),
                    (None, Some(b)) => Some(b.clone()),
                    (None, None) => None,
                };
                let from_key = bp.slug.clone().unwrap_or_else(|| bp.location.clone());
                let to_key = sp.slug.clone().unwrap_or_else(|| sp.location.clone());
                let leg = LegStatic {
                    commodity: commodity.clone(),
                    from_key: from_key.clone(),
                    to_key,
                    from_location: bp.location.clone(),
                    to_location: sp.location.clone(),
                    from_name: readable(&bp.slug, &bp.location),
                    to_name: readable(&sp.slug, &sp.location),
                    from_uuid: bp.slug.as_ref().and_then(|s| m.slug_uuid.get(s)).cloned(),
                    to_uuid: sp.slug.as_ref().and_then(|s| m.slug_uuid.get(s)).cloned(),
                    from_system,
                    to_system,
                    buy_price: bp.price,
                    sell_price: sp.price,
                    margin_unit: margin,
                    cargo_cap: cap,
                    jumps,
                    distance_gm,
                    time_minutes,
                    fuel_scu: distance_gm.zip(m.qt_fuel_per_gm).map(|(d, f)| d * f),
                    price_timestamp,
                    affluence: affluence_level(sp),
                };
                legs_from.entry(from_key).or_default().push(leg);
            }
        }
    }
    for v in legs_from.values_mut() {
        v.sort_by(|a, b| leg_potential(b).partial_cmp(&leg_potential(a)).unwrap_or(std::cmp::Ordering::Equal));
    }
    legs_from
}

/// Résultat d'une boucle/chaîne (legs = CargoRoute → réutilise modale détails + soute).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopResult {
    pub legs: Vec<CargoRoute>,
    pub total_profit: f64,
    pub total_time_minutes: Option<f64>,
    pub hops: i64,
    pub closed: bool,
    pub start_location: String,
    pub end_location: String,
    pub note: Option<String>,
}

/// Chaîne en construction (interne au beam).
#[derive(Clone)]
pub(crate) struct Chain {
    pub(crate) legs: Vec<LegStatic>,
    pub(crate) qtys: Vec<i64>,
    pub(crate) used: std::collections::HashSet<(String, String, String)>,
    pub(crate) budget: f64,
    pub(crate) total_profit: f64,
    pub(crate) total_time: f64,
    pub(crate) all_timed: bool,
    pub(crate) start_key: String,
    pub(crate) start_name: String,
    pub(crate) cur_key: String,
    pub(crate) cur_name: String,
}

/// Classement d'une chaîne : (chronométrée d'abord, puis valeur décroissante). Valeur =
/// profit total / temps total si toute la chaîne est chronométrée, sinon profit total.
pub(crate) fn chain_key(c: &Chain) -> (i32, f64) {
    if c.all_timed && c.total_time > 0.0 {
        (1, c.total_profit / c.total_time)
    } else {
        (0, c.total_profit)
    }
}

pub(crate) fn consider(best: &mut Option<Chain>, c: &Chain) {
    let better = match best {
        None => true,
        Some(b) => chain_key(c) > chain_key(b),
    };
    if better {
        *best = Some(c.clone());
    }
}

/// Beam search glouton. Renvoie la meilleure chaîne (fermée OU ouverte selon `closed`).
pub(crate) fn run_loop(
    legs_from: &std::collections::HashMap<String, Vec<LegStatic>>,
    resource: &str,
    budget0: f64,
    closed: bool,
    max_hops: i64,
    beam_width: usize,
) -> LoopResult {
    use std::collections::HashSet;
    const CAND_PER_NODE: usize = 6;

    let none_result = || -> LoopResult {
        let note = if closed {
            "Aucune boucle fermée rentable trouvée — essaie plus de points ou le mode ouvert."
        } else {
            "Aucune chaîne rentable trouvée pour cette ressource (prix Cargo à synchroniser ?)."
        };
        LoopResult {
            legs: vec![],
            total_profit: 0.0,
            total_time_minutes: None,
            hops: 0,
            closed: false,
            start_location: String::new(),
            end_location: String::new(),
            note: Some(note.to_string()),
        }
    };

    // Legs de départ = ceux dont la commodité == ressource choisie.
    let mut starts: Vec<&LegStatic> = legs_from
        .values()
        .flatten()
        .filter(|l| l.commodity.eq_ignore_ascii_case(resource))
        .collect();
    starts.sort_by(|a, b| leg_potential(b).partial_cmp(&leg_potential(a)).unwrap_or(std::cmp::Ordering::Equal));

    let mut beam: Vec<Chain> = Vec::new();
    for l in starts.into_iter().take(beam_width) {
        let qty = qty_for(l, budget0);
        if qty < 1 {
            continue;
        }
        let profit = l.margin_unit * qty as f64;
        if profit <= 0.0 {
            continue;
        }
        let mut used = HashSet::new();
        used.insert((l.commodity.clone(), l.from_key.clone(), l.to_key.clone()));
        beam.push(Chain {
            legs: vec![l.clone()],
            qtys: vec![qty],
            used,
            budget: budget0 + profit,
            total_profit: profit,
            total_time: l.time_minutes.unwrap_or(0.0),
            all_timed: l.time_minutes.is_some(),
            start_key: l.from_key.clone(),
            start_name: l.from_name.clone().unwrap_or_else(|| l.from_location.clone()),
            cur_key: l.to_key.clone(),
            cur_name: l.to_name.clone().unwrap_or_else(|| l.to_location.clone()),
        });
    }
    if beam.is_empty() {
        return none_result();
    }

    let mut best_open: Option<Chain> = None;
    let mut best_closed: Option<Chain> = None;
    for c in &beam {
        consider(&mut best_open, c); // 1 saut ne peut pas fermer (from != to garanti)
    }

    let cap = max_hops.clamp(1, 30) as usize;
    for _depth in 1..cap {
        let mut next: Vec<Chain> = Vec::new();
        for c in &beam {
            let Some(cands) = legs_from.get(&c.cur_key) else { continue };
            let mut taken = 0usize;
            for l in cands {
                let closes = l.to_key == c.start_key;
                // Limite de candidats par nœud, MAIS un leg qui ferme (mode fermé) est
                // toujours autorisé (ne pas rater une fermeture rangée plus bas).
                if taken >= CAND_PER_NODE && !(closed && closes) {
                    continue;
                }
                let key = (l.commodity.clone(), l.from_key.clone(), l.to_key.clone());
                if c.used.contains(&key) {
                    continue;
                }
                let qty = qty_for(l, c.budget);
                if qty < 1 {
                    continue;
                }
                let profit = l.margin_unit * qty as f64;
                if profit <= 0.0 {
                    continue;
                }
                taken += 1;
                let mut nc = c.clone();
                nc.legs.push(l.clone());
                nc.qtys.push(qty);
                nc.used.insert(key);
                nc.budget += profit;
                nc.total_profit += profit;
                match l.time_minutes {
                    Some(t) => nc.total_time += t,
                    None => nc.all_timed = false,
                }
                nc.cur_key = l.to_key.clone();
                nc.cur_name = l.to_name.clone().unwrap_or_else(|| l.to_location.clone());
                consider(&mut best_open, &nc);
                if nc.cur_key == nc.start_key {
                    consider(&mut best_closed, &nc);
                }
                next.push(nc);
            }
        }
        if next.is_empty() {
            break;
        }
        next.sort_by(|a, b| chain_key(b).partial_cmp(&chain_key(a)).unwrap_or(std::cmp::Ordering::Equal));
        next.truncate(beam_width);
        beam = next;
    }

    let chosen = if closed { best_closed } else { best_open };
    match chosen {
        None => none_result(),
        Some(c) => {
            let legs: Vec<CargoRoute> = c
                .legs
                .iter()
                .zip(c.qtys.iter())
                .map(|(l, q)| leg_to_route(l, *q))
                .collect();
            LoopResult {
                total_time_minutes: if c.all_timed { Some(c.total_time) } else { None },
                hops: legs.len() as i64,
                closed: c.cur_key == c.start_key,
                start_location: c.start_name.clone(),
                end_location: c.cur_name.clone(),
                total_profit: c.total_profit,
                legs,
                note: None,
            }
        }
    }
}
