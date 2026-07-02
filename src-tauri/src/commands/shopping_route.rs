// Planificateur de "panier d'achat" (Catalogue) : depuis un point de départ, construit un
// itinéraire multi-arrêts couvrant TOUS les items du panier en minimisant le TEMPS de trajet.
//
// Réutilise le modèle de positions/graphe/temps du GPS trading :
//   • positions terminaux : UexTerminal.wikiUuid → WikiLocationPosition (x/y/z + système) ;
//   • distance/sauts inter-systèmes : cargo_routes::route_distance (BFS sur les portes) ;
//   • temps quantique : travel_physics::qt_travel_seconds (rampe accel → vmax → tt10).
// 100 % lecture base. Le PLACEMENT exact n'est pas fourni → le temps est une estimation ;
// un terminal sans position résolue reste utilisable (regroupé, mais hors calcul de temps).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::commands::cargo_routes::{route_distance, Pos};
use crate::commands::travel_physics::qt_travel_seconds;
use crate::DB_URL;

/* ─────────────────────────────── Cœur d'optimisation (pur) ────────────────────────────── */

/// Un point d'achat candidat pour un item du panier.
#[derive(Clone)]
pub struct Cand {
    pub term_key: String,          // clé de terminal (wikiSlug/"uex-{id}") — regroupe les items
    pub term_name: String,         // nom affichable du terminal
    pub location: String,          // libellé de lieu composé (ville · planète, système)
    pub system: Option<String>,    // système (pour regroupement / repli)
    pub pos_uuid: Option<String>,  // clé position (WikiLocationPosition.uuid) — None si non géolocalisé
    pub price: i64,                // prix aUEC à ce terminal
}

/// Un arrêt planifié : un terminal + les items à y acheter (index panier, prix retenu).
#[derive(Clone)]
pub struct PlannedStop {
    pub term_key: String,
    pub term_name: String,
    pub location: String,
    pub system: Option<String>,
    pub pos_uuid: Option<String>,
    pub items: Vec<(usize, i64)>,
}

/// Sélection gloutonne des terminaux (objectif TEMPS → MOINS d'arrêts) : à chaque tour on
/// prend le terminal qui couvre le plus d'items encore non couverts ; à égalité, celui dont
/// la somme des prix (pour ces items) est la plus basse. Départage stable par clé.
pub fn select_terminals(item_cands: &[Vec<Cand>]) -> Vec<PlannedStop> {
    // Index : term_key → (méta, item_idx → meilleur prix à ce terminal).
    let mut by_term: HashMap<String, (Cand, HashMap<usize, i64>)> = HashMap::new();
    for (idx, cands) in item_cands.iter().enumerate() {
        for c in cands {
            let e = by_term.entry(c.term_key.clone()).or_insert_with(|| (c.clone(), HashMap::new()));
            e.1.entry(idx).and_modify(|p| *p = (*p).min(c.price)).or_insert(c.price);
        }
    }

    let total_items = item_cands.len();
    let mut covered: HashSet<usize> = HashSet::new();
    // Un item sans aucun candidat ne sera jamais couvert → on le retire de la cible.
    for (idx, cands) in item_cands.iter().enumerate() {
        if cands.is_empty() {
            covered.insert(idx);
        }
    }

    let mut stops: Vec<PlannedStop> = Vec::new();
    while covered.len() < total_items {
        // Meilleur terminal ce tour.
        let mut best: Option<(String, usize, i64)> = None; // (key, gain, sum_price)
        for (key, (_, items)) in by_term.iter() {
            let fresh: Vec<(&usize, &i64)> = items.iter().filter(|(i, _)| !covered.contains(i)).collect();
            if fresh.is_empty() {
                continue;
            }
            let gain = fresh.len();
            let sum: i64 = fresh.iter().map(|(_, p)| **p).sum();
            let better = match &best {
                None => true,
                Some((bk, bg, bs)) => gain > *bg || (gain == *bg && (sum < *bs || (sum == *bs && key < bk))),
            };
            if better {
                best = Some((key.clone(), gain, sum));
            }
        }
        let Some((key, _, _)) = best else { break }; // sécurité : plus rien à couvrir
        let (meta, items) = by_term.get(&key).unwrap();
        let mut assigned: Vec<(usize, i64)> = items
            .iter()
            .filter(|(i, _)| !covered.contains(i))
            .map(|(i, p)| (*i, *p))
            .collect();
        assigned.sort_by_key(|(i, _)| *i);
        for (i, _) in &assigned {
            covered.insert(*i);
        }
        stops.push(PlannedStop {
            term_key: meta.term_key.clone(),
            term_name: meta.term_name.clone(),
            location: meta.location.clone(),
            system: meta.system.clone(),
            pos_uuid: meta.pos_uuid.clone(),
            items: assigned,
        });
    }
    stops
}

/// Ordonne les arrêts pour minimiser le temps depuis `start` (plus proche voisin + 2-opt).
/// `time_between(a, b)` = minutes entre deux positions (None si incalculable). Les arrêts
/// sans position sont placés en fin, dans l'ordre initial.
pub fn order_stops(
    stops: Vec<PlannedStop>,
    start: Option<&str>,
    time_between: &dyn Fn(&str, &str) -> Option<f64>,
) -> Vec<PlannedStop> {
    let (positioned, unpositioned): (Vec<PlannedStop>, Vec<PlannedStop>) =
        stops.into_iter().partition(|s| s.pos_uuid.is_some());
    if positioned.len() <= 1 {
        return [positioned, unpositioned].concat();
    }

    let key = |s: &PlannedStop| s.pos_uuid.clone().unwrap();
    let big = f64::INFINITY;
    let cost = |a: &str, b: &str| time_between(a, b).unwrap_or(big);

    // Plus proche voisin depuis start (ou depuis le 1er arrêt si pas de start positionné).
    let n = positioned.len();
    let mut used = vec![false; n];
    let mut order: Vec<usize> = Vec::with_capacity(n);
    let mut cur_key: Option<String> = start.map(|s| s.to_string());
    for _ in 0..n {
        let mut best = None;
        for i in 0..n {
            if used[i] {
                continue;
            }
            let c = match &cur_key {
                Some(k) => cost(k, &key(&positioned[i])),
                None => 0.0, // pas de départ → 1er arrêt libre
            };
            if best.map(|(_, bc)| c < bc).unwrap_or(true) {
                best = Some((i, c));
            }
        }
        let (i, _) = best.unwrap();
        used[i] = true;
        order.push(i);
        cur_key = Some(key(&positioned[i]));
    }

    // 2-opt (N petit) : inverse un segment si ça réduit le coût total depuis start.
    let path_cost = |ord: &[usize]| -> f64 {
        let mut total = 0.0;
        let mut prev = start.map(|s| s.to_string());
        for &i in ord {
            if let Some(p) = &prev {
                total += cost(p, &key(&positioned[i]));
            }
            prev = Some(key(&positioned[i]));
        }
        total
    };
    let mut improved = true;
    while improved {
        improved = false;
        for a in 0..n.saturating_sub(1) {
            for b in (a + 1)..n {
                let mut cand = order.clone();
                cand[a..=b].reverse();
                if path_cost(&cand) + 1e-9 < path_cost(&order) {
                    order = cand;
                    improved = true;
                }
            }
        }
    }

    let mut ordered: Vec<PlannedStop> = order.into_iter().map(|i| positioned[i].clone()).collect();
    ordered.extend(unpositioned);
    ordered
}

/* ─────────────────────────────── Chargement base + commande ───────────────────────────── */

#[derive(Deserialize)]
pub struct CartLine {
    pub id_item: Option<i64>,
    pub uuid: Option<String>,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopItem {
    pub name: String,
    pub price: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStop {
    pub terminal_name: String,
    pub location: String,
    pub system: Option<String>,
    pub items: Vec<StopItem>,
    pub subtotal_auec: i64,
    pub leg_minutes: Option<f64>, // temps depuis l'arrêt précédent (ou le départ)
    pub leg_jumps: i64,
    pub positioned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoppingRouteResult {
    pub found: bool,
    pub stops: Vec<RouteStop>,
    pub total_auec: i64,
    pub total_minutes: Option<f64>, // None si un arrêt n'est pas chronométrable
    pub total_jumps: i64,
    pub unresolved_items: Vec<String>, // items sans point d'achat connu
    pub timed: bool,                   // modèle de temps disponible
}

/// Paramètres du meilleur drive quantique en base (estimation générique du temps).
struct QtParams {
    vmax: Option<f64>,
    a1: Option<f64>,
    a2: Option<f64>,
    tt10: Option<f64>,
    spool: f64,
}

async fn load_qt_params(pool: &sqlx::SqlitePool) -> QtParams {
    let row = sqlx::query(
        "SELECT qtDriveSpeed, qtAccelStageOne, qtAccelStageTwo, qtTravelTime10gm, qtSpoolTime
           FROM Component
          WHERE type = 'QUANTUM_DRIVE' AND qtDriveSpeed IS NOT NULL AND qtDriveSpeed > 0
          ORDER BY qtDriveSpeed DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    use sqlx::Row;
    match row {
        Some(r) => QtParams {
            vmax: r.try_get::<Option<f64>, _>("qtDriveSpeed").ok().flatten(),
            a1: r.try_get::<Option<f64>, _>("qtAccelStageOne").ok().flatten(),
            a2: r.try_get::<Option<f64>, _>("qtAccelStageTwo").ok().flatten(),
            tt10: r.try_get::<Option<f64>, _>("qtTravelTime10gm").ok().flatten(),
            spool: r.try_get::<Option<f64>, _>("qtSpoolTime").ok().flatten().unwrap_or(0.0),
        },
        None => QtParams { vmax: None, a1: None, a2: None, tt10: None, spool: 0.0 },
    }
}

async fn load_positions(pool: &sqlx::SqlitePool) -> HashMap<String, Pos> {
    use sqlx::Row;
    let mut pos = HashMap::new();
    if let Ok(rows) = sqlx::query("SELECT uuid, x, y, z, systemName FROM WikiLocationPosition")
        .fetch_all(pool)
        .await
    {
        for r in rows {
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
    }
    pos
}

async fn load_graph(pool: &sqlx::SqlitePool) -> HashMap<String, Vec<(String, String, String)>> {
    use sqlx::Row;
    let mut graph: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    if let Ok(rows) = sqlx::query("SELECT entryUuid, exitUuid, entrySystem, exitSystem FROM WikiJumpConnection")
        .fetch_all(pool)
        .await
    {
        for r in rows {
            let entry: String = r.try_get("entryUuid").unwrap_or_default();
            let exit: String = r.try_get("exitUuid").unwrap_or_default();
            let es: String = r.try_get::<Option<String>, _>("entrySystem").ok().flatten().unwrap_or_default();
            let xs: String = r.try_get::<Option<String>, _>("exitSystem").ok().flatten().unwrap_or_default();
            if entry.is_empty() || exit.is_empty() || es.is_empty() || xs.is_empty() {
                continue;
            }
            graph.entry(es.clone()).or_default().push((xs.clone(), entry.clone(), exit.clone()));
            graph.entry(xs).or_default().push((es, exit, entry));
        }
    }
    graph
}

/// Compose un libellé de lieu lisible depuis les colonnes UexTerminal.
fn compose_location(city: Option<String>, station: Option<String>, outpost: Option<String>, moon: Option<String>, planet: Option<String>, system: Option<String>) -> String {
    let place = city.or(station).or(outpost).or(moon).or(planet);
    match (place, system) {
        (Some(p), Some(s)) => format!("{p}, {s}"),
        (Some(p), None) => p,
        (None, Some(s)) => s,
        (None, None) => "—".to_string(),
    }
}

/// Charge les points d'achat candidats par item (avec position via UexTerminal → WikiLocationPosition).
async fn load_candidates(pool: &sqlx::SqlitePool, line: &CartLine) -> Vec<Cand> {
    use sqlx::Row;
    let base = "SELECT p.priceBuy AS priceBuy, t.id AS tid, t.displayName AS displayName,
                       t.wikiSlug AS wikiSlug, t.wikiUuid AS wikiUuid, t.systemName AS systemName,
                       t.planetName AS planetName, t.moonName AS moonName, t.cityName AS cityName,
                       t.spaceStationName AS spaceStationName, t.outpostName AS outpostName,
                       wp.uuid AS posUuid
                  FROM ItemPrice p
                  JOIN UexTerminal t ON t.id = p.idTerminal
                  LEFT JOIN WikiLocationPosition wp ON wp.uuid = t.wikiUuid
                 WHERE p.priceBuy > 0 AND ";
    let rows = if let Some(id) = line.id_item {
        sqlx::query(&format!("{base} p.idItem = ? ORDER BY p.priceBuy ASC")).bind(id).fetch_all(pool).await
    } else if let Some(u) = line.uuid.as_ref().filter(|s| !s.is_empty()) {
        sqlx::query(&format!("{base} p.itemUuid = ? ORDER BY p.priceBuy ASC")).bind(u).fetch_all(pool).await
    } else {
        return Vec::new();
    };
    let Ok(rows) = rows else { return Vec::new() };

    let mut out = Vec::new();
    for r in rows {
        let price = r.try_get::<Option<f64>, _>("priceBuy").ok().flatten().unwrap_or(0.0);
        if price <= 0.0 {
            continue;
        }
        let tid: i64 = r.try_get("tid").unwrap_or_default();
        let slug: Option<String> = r.try_get::<Option<String>, _>("wikiSlug").ok().flatten().filter(|s| !s.is_empty());
        let term_key = slug.unwrap_or_else(|| format!("uex-{tid}"));
        let term_name = r.try_get::<Option<String>, _>("displayName").ok().flatten().unwrap_or_else(|| "—".into());
        let system = r.try_get::<Option<String>, _>("systemName").ok().flatten();
        let location = compose_location(
            r.try_get::<Option<String>, _>("cityName").ok().flatten(),
            r.try_get::<Option<String>, _>("spaceStationName").ok().flatten(),
            r.try_get::<Option<String>, _>("outpostName").ok().flatten(),
            r.try_get::<Option<String>, _>("moonName").ok().flatten(),
            r.try_get::<Option<String>, _>("planetName").ok().flatten(),
            system.clone(),
        );
        let pos_uuid = r.try_get::<Option<String>, _>("posUuid").ok().flatten();
        out.push(Cand { term_key, term_name, location, system, pos_uuid, price: price.round() as i64 });
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLocation {
    pub uuid: String,
    pub name: String,
    pub system: Option<String>,
}

/// Lieux de départ possibles (points QT valides, positionnés) pour le sélecteur du panier.
#[tauri::command]
pub async fn get_start_locations(
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<StartLocation>, String> {
    use sqlx::Row;
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let rows = sqlx::query(
        "SELECT uuid, name, systemName FROM WikiLocationPosition
          WHERE name IS NOT NULL AND name <> '' AND hidden = 0 AND qtValid = 1
          ORDER BY systemName, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| StartLocation {
            uuid: r.try_get("uuid").unwrap_or_default(),
            name: r.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
            system: r.try_get::<Option<String>, _>("systemName").ok().flatten(),
        })
        .collect())
}

/// Planifie l'itinéraire d'achat du panier depuis `start_uuid` (position de départ, optionnelle).
#[tauri::command]
pub async fn plan_shopping_route(
    items: Vec<CartLine>,
    start_uuid: Option<String>,
    db_instances: State<'_, DbInstances>,
) -> Result<ShoppingRouteResult, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    if items.is_empty() {
        return Ok(ShoppingRouteResult {
            found: false,
            stops: Vec::new(),
            total_auec: 0,
            total_minutes: Some(0.0),
            total_jumps: 0,
            unresolved_items: Vec::new(),
            timed: false,
        });
    }

    // Candidats par item + items non résolus (aucun point d'achat).
    let mut item_cands: Vec<Vec<Cand>> = Vec::with_capacity(items.len());
    let mut unresolved: Vec<String> = Vec::new();
    for line in &items {
        let c = load_candidates(pool, line).await;
        if c.is_empty() {
            unresolved.push(line.name.clone());
        }
        item_cands.push(c);
    }

    // Sélection des terminaux (moins d'arrêts) puis modèle de temps.
    let stops = select_terminals(&item_cands);
    if stops.is_empty() {
        return Ok(ShoppingRouteResult {
            found: false,
            stops: Vec::new(),
            total_auec: 0,
            total_minutes: None,
            total_jumps: 0,
            unresolved_items: unresolved,
            timed: false,
        });
    }

    let pos = load_positions(pool).await;
    let graph = load_graph(pool).await;
    let qt = load_qt_params(pool).await;
    let timed = pos.len() > 1 && qt.vmax.is_some();

    // Temps (minutes) entre deux positions via distance BFS + modèle QT (+ spool par saut).
    let time_between = |a: &str, b: &str| -> Option<f64> {
        let (dist, legs) = route_distance(a, b, &pos, &graph)?;
        let sec = qt_travel_seconds(dist, qt.vmax, qt.a1, qt.a2, qt.tt10)? + qt.spool * legs as f64;
        Some(sec / 60.0)
    };

    let start = start_uuid.as_deref().filter(|s| pos.contains_key(*s));
    let ordered = order_stops(stops, start, &time_between);

    // Sérialisation + temps par leg (depuis le départ pour le 1er arrêt).
    let mut out_stops: Vec<RouteStop> = Vec::with_capacity(ordered.len());
    let mut prev_key: Option<String> = start.map(|s| s.to_string());
    let mut total_auec = 0i64;
    let mut total_minutes = Some(0.0f64);
    let mut total_jumps = 0i64;

    for st in &ordered {
        let subtotal: i64 = st.items.iter().map(|(_, p)| *p).sum();
        total_auec += subtotal;
        let (leg_min, jumps) = match (&prev_key, &st.pos_uuid) {
            (Some(pk), Some(cur)) => match route_distance(pk, cur, &pos, &graph) {
                Some((dist, legs)) => {
                    let m = qt_travel_seconds(dist, qt.vmax, qt.a1, qt.a2, qt.tt10).map(|s| (s + qt.spool * legs as f64) / 60.0);
                    (m, legs)
                }
                None => (None, 0),
            },
            _ => (None, 0),
        };
        if let Some(m) = leg_min {
            total_minutes = total_minutes.map(|t| t + m);
            total_jumps += jumps;
        } else {
            total_minutes = None; // un leg non chronométrable → total inconnu
        }
        let items_out: Vec<StopItem> = st
            .items
            .iter()
            .map(|(idx, price)| StopItem { name: items[*idx].name.clone(), price: *price })
            .collect();
        out_stops.push(RouteStop {
            terminal_name: st.term_name.clone(),
            location: st.location.clone(),
            system: st.system.clone(),
            items: items_out,
            subtotal_auec: subtotal,
            leg_minutes: leg_min,
            leg_jumps: jumps,
            positioned: st.pos_uuid.is_some(),
        });
        if st.pos_uuid.is_some() {
            prev_key = st.pos_uuid.clone();
        }
    }

    Ok(ShoppingRouteResult {
        found: true,
        stops: out_stops,
        total_auec,
        total_minutes,
        total_jumps,
        unresolved_items: unresolved,
        timed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(term: &str, price: i64, pos: Option<&str>) -> Cand {
        Cand {
            term_key: term.into(),
            term_name: term.into(),
            location: term.into(),
            system: Some("Stanton".into()),
            pos_uuid: pos.map(|s| s.into()),
            price,
        }
    }

    #[test]
    fn select_terminals_groups_to_fewest_stops() {
        // item0 @ A/B, item1 @ A/C, item2 @ A → A couvre les 3 → 1 seul arrêt.
        let items = vec![
            vec![cand("A", 10, Some("a")), cand("B", 9, Some("b"))],
            vec![cand("A", 20, Some("a")), cand("C", 5, Some("c"))],
            vec![cand("A", 3, Some("a"))],
        ];
        let stops = select_terminals(&items);
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].term_key, "A");
        assert_eq!(stops[0].items.len(), 3);
    }

    #[test]
    fn select_terminals_covers_all_when_disjoint() {
        let items = vec![vec![cand("A", 10, Some("a"))], vec![cand("B", 10, Some("b"))]];
        let stops = select_terminals(&items);
        let keys: HashSet<_> = stops.iter().map(|s| s.term_key.clone()).collect();
        assert_eq!(keys, HashSet::from(["A".to_string(), "B".to_string()]));
    }

    #[test]
    fn select_terminals_ignores_items_without_candidates() {
        let items = vec![vec![cand("A", 10, Some("a"))], vec![]];
        let stops = select_terminals(&items);
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].items, vec![(0, 10)]);
    }

    #[test]
    fn order_stops_nearest_neighbor_from_start() {
        // positions sur une ligne : start=0, a=1, b=2, c=3 → temps = |diff|.
        let coords: HashMap<&str, f64> =
            HashMap::from([("s", 0.0), ("a", 1.0), ("b", 2.0), ("c", 3.0)]);
        let tb = move |x: &str, y: &str| Some((coords[x] - coords[y]).abs());
        let stops = vec![
            PlannedStop { term_key: "C".into(), term_name: "C".into(), location: "".into(), system: None, pos_uuid: Some("c".into()), items: vec![(0, 1)] },
            PlannedStop { term_key: "A".into(), term_name: "A".into(), location: "".into(), system: None, pos_uuid: Some("a".into()), items: vec![(1, 1)] },
            PlannedStop { term_key: "B".into(), term_name: "B".into(), location: "".into(), system: None, pos_uuid: Some("b".into()), items: vec![(2, 1)] },
        ];
        let ordered = order_stops(stops, Some("s"), &tb);
        let keys: Vec<_> = ordered.iter().map(|s| s.term_key.clone()).collect();
        assert_eq!(keys, vec!["A", "B", "C"]);
    }

    #[test]
    fn order_stops_appends_unpositioned_last() {
        let tb = |_: &str, _: &str| Some(1.0);
        let stops = vec![
            PlannedStop { term_key: "NP".into(), term_name: "NP".into(), location: "".into(), system: None, pos_uuid: None, items: vec![(0, 1)] },
            PlannedStop { term_key: "P".into(), term_name: "P".into(), location: "".into(), system: None, pos_uuid: Some("p".into()), items: vec![(1, 1)] },
        ];
        let ordered = order_stops(stops, Some("p"), &tb);
        assert_eq!(ordered.last().unwrap().term_key, "NP");
    }
}
