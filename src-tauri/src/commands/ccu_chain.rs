use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

macro_rules! sqlite_pool {
    ($instances:expr) => {{
        let db = $instances
            .get(DB_URL)
            .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
        match db {
            DbPool::Sqlite(pool) => pool,
            #[allow(unreachable_patterns)]
            _ => return Err("Connexion SQLite attendue".into()),
        }
    }};
}

/* ───────────────────────── get_ccu_catalog_status ───────────────────────── */

#[tauri::command]
#[allow(unused_variables)]
pub async fn get_ccu_catalog_status(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let skus = sqlx::query("SELECT COUNT(*) as count FROM CcuSku")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let upgrades = sqlx::query("SELECT COUNT(*) as count FROM CcuUpgrade")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let last_sync_at = sqlx::query("SELECT value FROM AppMeta WHERE key = 'ccu.lastSyncAt'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    Ok(json!({
        "hasSkus": skus > 0,
        "hasUpgrades": upgrades > 0,
        "lastSyncAt": last_sync_at,
    }))
}

/* ──────────────────────── get_ccu_ships_metadata ────────────────────────── */

/// Tokens marquant un nom ShipData comme variante cosmétique/événement (pas le
/// chassis de base). Permet de garder le vaisseau de base comme nom canonique.
const VARIANT_NAME_TOKENS: [&str; 9] = [
    "wikelo", "pyam", "exec", "bis", "special", "edition", "color", "snowblind", "snowland",
];

fn is_variant_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    VARIANT_NAME_TOKENS.iter().any(|t| lower.contains(t))
}

/// Métadonnées de TOUS les chassis du graphe CCU — UNION des cibles achetables
/// (CcuSku.shipId) ET des sources d'upgrade (CcuUpgrade.fromShipId, souvent sans SKU).
/// Hydraté depuis ShipData (rsiShipId) ; repli RsiShipName puis « Ship #<id> ». Prix =
/// SKU le moins cher, sinon MSRP. Dédup canonique (vaisseau de base > variantes).
#[tauri::command]
pub async fn get_ccu_ships_metadata(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // 1. SKUs → prix le moins cher + disponibilité par shipId (cibles achetables).
    let sku_rows = sqlx::query("SELECT shipId, priceCents, available FROM CcuSku")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut cheapest_by_ship: HashMap<i64, i64> = HashMap::new();
    let mut available_by_ship: HashSet<i64> = HashSet::new();
    for r in &sku_rows {
        let ship_id = r.try_get::<i64, _>("shipId").map_err(|e| e.to_string())?;
        let price = r.try_get::<i64, _>("priceCents").map_err(|e| e.to_string())?;
        cheapest_by_ship
            .entry(ship_id)
            .and_modify(|c| {
                if price < *c {
                    *c = price;
                }
            })
            .or_insert(price);
        if r.try_get::<i64, _>("available").unwrap_or(0) == 1 {
            available_by_ship.insert(ship_id);
        }
    }

    // 2. Sources d'upgrade (CcuUpgrade.fromShipId) — souvent sans CcuSku.
    let from_rows = sqlx::query("SELECT DISTINCT fromShipId FROM CcuUpgrade")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    // 3. ShipData (SC Wiki) : nom/fabricant/focus/msrp/image.
    let ship_rows = sqlx::query(
        "SELECT rsiShipId, name, manufacturer, focus, msrpUsd, imageUrl
         FROM ShipData WHERE rsiShipId IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // 4. RsiShipName (repli pour les chassis absents du SC Wiki).
    let rsi_rows = sqlx::query("SELECT shipId, name FROM RsiShipName")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    // 5. Possédés (rsiShipId) du compte actif.
    let owned_rows = sqlx::query(
        "SELECT DISTINCT sd.rsiShipId FROM Ship s JOIN ShipData sd ON sd.name = s.name
         WHERE s.accountId = ? AND sd.rsiShipId IS NOT NULL",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let owned_ids: HashSet<i64> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten())
        .collect();

    // Union des chassis : cibles achetables + sources d'upgrade.
    let mut ship_ids: HashSet<i64> = cheapest_by_ship.keys().copied().collect();
    for r in &from_rows {
        if let Ok(id) = r.try_get::<i64, _>("fromShipId") {
            ship_ids.insert(id);
        }
    }

    // Dédup canonique : non-variante d'abord, puis nom le plus court ; first-wins.
    struct Meta {
        name: String,
        manufacturer: Option<String>,
        focus: Option<String>,
        image_url: Option<String>,
    }
    let mut rows_sorted: Vec<(i64, String, Option<String>, Option<String>, Option<i64>, Option<String>)> =
        ship_rows
            .iter()
            .filter_map(|r| {
                let id = r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten()?;
                let name = r.try_get::<String, _>("name").ok()?;
                Some((
                    id,
                    name,
                    r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
                    r.try_get::<Option<String>, _>("focus")
                        .ok()
                        .flatten()
                        .filter(|s| !s.is_empty()),
                    r.try_get::<Option<i64>, _>("msrpUsd").ok().flatten(),
                    r.try_get::<Option<String>, _>("imageUrl").ok().flatten(),
                ))
            })
            .collect();
    rows_sorted.sort_by(|a, b| {
        let va = is_variant_name(&a.1) as i32;
        let vb = is_variant_name(&b.1) as i32;
        va.cmp(&vb).then_with(|| a.1.len().cmp(&b.1.len()))
    });
    let mut meta_by_id: HashMap<i64, Meta> = HashMap::new();
    let mut msrp_by_id: HashMap<i64, i64> = HashMap::new();
    for (id, name, manufacturer, focus, msrp, image_url) in rows_sorted {
        meta_by_id.entry(id).or_insert(Meta {
            name,
            manufacturer,
            focus,
            image_url,
        });
        if let Some(m) = msrp {
            msrp_by_id.entry(id).or_insert(m * 100);
        }
    }

    let mut rsi_name_by_id: HashMap<i64, String> = HashMap::new();
    for r in &rsi_rows {
        if let (Ok(id), Ok(name)) = (
            r.try_get::<i64, _>("shipId"),
            r.try_get::<String, _>("name"),
        ) {
            rsi_name_by_id.insert(id, name);
        }
    }

    let mut out: Vec<Value> = Vec::with_capacity(ship_ids.len());
    for ship_id in ship_ids {
        let meta = meta_by_id.get(&ship_id);
        let name = meta
            .map(|m| m.name.clone())
            .or_else(|| rsi_name_by_id.get(&ship_id).cloned())
            .unwrap_or_else(|| format!("Ship #{ship_id}"));
        // Prix : CcuSku le moins cher, sinon MSRP (déjà en cents), sinon null.
        let ccu_price = cheapest_by_ship.get(&ship_id).copied();
        let msrp_price = msrp_by_id.get(&ship_id).copied();
        let (price_cents, price_source): (Option<i64>, Option<&str>) = match ccu_price {
            Some(c) => (Some(c), Some("ccu")),
            None => match msrp_price {
                Some(m) => (Some(m), Some("msrp")),
                None => (None, None),
            },
        };
        out.push(json!({
            "shipId": ship_id,
            "name": name,
            "manufacturer": meta.and_then(|m| m.manufacturer.clone()),
            "focus": meta.and_then(|m| m.focus.clone()),
            "imageUrl": meta.and_then(|m| m.image_url.clone()),
            "priceCents": price_cents,
            "priceSource": price_source,
            "isOwned": owned_ids.contains(&ship_id),
            "isAvailable": available_by_ship.contains(&ship_id),
        }));
    }
    out.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
    });
    Ok(out)
}

/* ─────────────────────────────  find_ccu_paths  ──────────────────────────── */
//
// DP par couches top-K sur le DAG strict des prix (chaque upgrade fait monter le prix
// standalone du vaisseau cible → aucun retour arrière possible, donc pas de « déjà
// visité » à gérer). `max_steps` est désormais une LONGUEUR EXACTE N : on renvoie les
// K=5 meilleures chaînes faisant PILE N sauts vers la cible, triées de la moins chère
// à la plus chère (moins de 5 si moins de 5 existent — on n'invente pas). Stratégies :
//   • currentSavings  : graphe complet, K meilleures chaînes de longueur N.
//   • longTermSavings : seules les arêtes warbond (warbondEndIndex = N-1) ; si la cible
//     n'est pas joignable en N sauts warbond, on complète : préfixe warbond + pont
//     standard, longueur TOTALE = N (warbondEndIndex marque la frontière).

const MAX_STEPS_HARD_CAP: i64 = 8;
const DEFAULT_MAX_STEPS: i64 = 5;
const DEFAULT_TOP_N: i64 = 30;
/// Coefficient de surcoût standard (confirmé = 1.032 sur toute la matrice CCU).
/// Sert à estimer l'économie du point d'arrêt warbond (stratégie long terme).
const STANDARD_MARKUP: f64 = 1.032;

/// Saut minimum « viable » : on ignore les CCU dont le prix d'upgrade est inférieur à ce
/// seuil, pour ne pas produire de chaînes truffées de micro-sauts dérisoires (UTV→X1 à ~$5).
/// 1500 = $15.00 (laisse passer le 1er palier réel $15.48 = $15 × markup 1.032).
const MIN_STEP_CENTS: i64 = 1500;
/// Largeur de la DP par couches : on garde les K meilleurs coûts par (nœud, profondeur),
/// ce qui suffit (DAG strict de prix) à obtenir les K meilleures chaînes à la cible pour
/// une longueur exacte donnée. Diagnostic : < 0.3 ms jusqu'à N=8, top-5 exact.
const LAYER_TOP_K: usize = 5;

#[derive(Clone)]
struct Edge {
    to_ship_id: i64,
    to_sku_id: i64,
    upgrade_price_cents: i64,
    to_sku_price_cents: i64,
    // True si l'arête vise le SKU le moins cher d'un vaisseau multi-SKU (= warbond).
    is_warbond: bool,
}

#[derive(Clone)]
struct LayerState {
    cost: i64,
    prev_ship_id: Option<i64>,
    // Index de l'entrée parente dans layers[depth-1][prev_ship_id] : permet de
    // reconstruire des chaînes DISTINCTES quand un nœud porte plusieurs prédécesseurs.
    prev_index: Option<usize>,
    edge: Option<Edge>,
}

#[derive(Clone, Serialize)]
struct StepData {
    #[serde(rename = "fromShipId")]
    from_ship_id: i64,
    #[serde(rename = "toShipId")]
    to_ship_id: i64,
    #[serde(rename = "toSkuId")]
    to_sku_id: i64,
    #[serde(rename = "toSkuPriceCents")]
    to_sku_price_cents: i64,
    #[serde(rename = "upgradePriceCents")]
    upgrade_price_cents: i64,
    #[serde(rename = "isOwnedSourceShip")]
    is_owned_source_ship: bool,
}

/// DP par couches top-K : couche[k][shipId] = les K meilleurs coûts (triés croissants)
/// pour atteindre shipId en EXACTEMENT k sauts depuis source_ship_id, chacun avec un
/// back-pointer (prev_ship_id, prev_index) vers l'entrée parente → chaînes distinctes.
/// `warbond_filter` ne suit que les arêtes warbond. Le filtre « depuis mes vaisseaux »
/// exempte toujours le from choisi par l'utilisateur (les sources intermédiaires choisies
/// par l'algo doivent, elles, être possédées). Réutilisé pour le complément standard.
#[allow(clippy::too_many_arguments)]
fn run_layered_dp(
    graph: &HashMap<i64, Vec<Edge>>,
    owned_set: &HashSet<i64>,
    user_from_ship_id: i64,
    only_owned_source: bool,
    source_ship_id: i64,
    budget: i64,
    warbond_filter: bool,
) -> Vec<HashMap<i64, Vec<LayerState>>> {
    let mut lyrs: Vec<HashMap<i64, Vec<LayerState>>> =
        Vec::with_capacity((budget + 1).max(1) as usize);
    let mut l0: HashMap<i64, Vec<LayerState>> = HashMap::new();
    l0.insert(
        source_ship_id,
        vec![LayerState {
            cost: 0,
            prev_ship_id: None,
            prev_index: None,
            edge: None,
        }],
    );
    lyrs.push(l0);

    for k in 1..=budget {
        let mut layer: HashMap<i64, Vec<LayerState>> = HashMap::new();
        let prev_layer = &lyrs[(k - 1) as usize];
        for (&ship_id, states) in prev_layer.iter() {
            if only_owned_source && ship_id != user_from_ship_id && !owned_set.contains(&ship_id) {
                continue;
            }
            let Some(edges) = graph.get(&ship_id) else {
                continue;
            };
            for (prev_idx, state) in states.iter().enumerate() {
                for edge in edges {
                    if warbond_filter && !edge.is_warbond {
                        continue;
                    }
                    let new_cost = state.cost + edge.upgrade_price_cents;
                    let bucket = layer.entry(edge.to_ship_id).or_default();
                    // N'insère que si ça entre dans le top-K (sinon on jette).
                    if bucket.len() >= LAYER_TOP_K && new_cost >= bucket[LAYER_TOP_K - 1].cost {
                        continue;
                    }
                    // Insertion triée stable (les coûts égaux gardent l'ordre d'arrivée →
                    // on conserve plusieurs chaînes distinctes de même coût).
                    let pos = bucket.partition_point(|s| s.cost <= new_cost);
                    bucket.insert(
                        pos,
                        LayerState {
                            cost: new_cost,
                            prev_ship_id: Some(ship_id),
                            prev_index: Some(prev_idx),
                            edge: Some(edge.clone()),
                        },
                    );
                    if bucket.len() > LAYER_TOP_K {
                        bucket.truncate(LAYER_TOP_K);
                    }
                }
            }
        }
        lyrs.push(layer);
    }
    lyrs
}

/// Remonte les couches depuis (k, end_ship_id, end_index) et émet les étapes en ordre
/// direct. `end_index` désigne laquelle des K entrées de la cellule reconstruire.
fn reconstruct_steps(
    src_layers: &[HashMap<i64, Vec<LayerState>>],
    k: i64,
    end_ship_id: i64,
    end_index: usize,
    owned_set: &HashSet<i64>,
) -> Option<Vec<StepData>> {
    let mut reverse: Vec<StepData> = Vec::new();
    let mut cur = end_ship_id;
    let mut idx = end_index;
    let mut depth = k;
    while depth > 0 {
        // Accès défensif : sur données DP incohérentes (scrape RSI inattendu), on
        // abandonne la reconstruction (None) au lieu de paniquer (crash app).
        let Some(node) = src_layers
            .get(depth as usize)
            .and_then(|m| m.get(&cur))
            .and_then(|v| v.get(idx))
        else {
            eprintln!("[ccu_chain] reconstruction interrompue : nœud DP introuvable");
            return None;
        };
        let Some(from_id) = node.prev_ship_id else {
            eprintln!("[ccu_chain] reconstruction interrompue : nœud DP sans prevShipId");
            return None;
        };
        let Some(e) = node.edge.as_ref() else {
            eprintln!("[ccu_chain] reconstruction interrompue : nœud DP sans edge");
            return None;
        };
        reverse.push(StepData {
            from_ship_id: from_id,
            to_ship_id: cur,
            to_sku_id: e.to_sku_id,
            to_sku_price_cents: e.to_sku_price_cents,
            upgrade_price_cents: e.upgrade_price_cents,
            is_owned_source_ship: owned_set.contains(&from_id),
        });
        cur = from_id;
        let Some(prev_index) = node.prev_index else {
            eprintln!("[ccu_chain] reconstruction interrompue : nœud DP sans prevIndex");
            return None;
        };
        idx = prev_index;
        depth -= 1;
    }
    reverse.reverse();
    Some(reverse)
}

struct ChainResultData {
    steps: Vec<StepData>,
    total_cost: i64,
    step_count: i64,
    warbond_end_index: Option<i64>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn find_ccu_paths(
    from_ship_id: i64,
    to_ship_id: i64,
    max_steps: Option<i64>,
    only_available: Option<bool>,
    only_owned_source: Option<bool>,
    top_n: Option<i64>,
    method: Option<String>,
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let only_available = only_available.unwrap_or(false);
    let only_owned_source = only_owned_source.unwrap_or(false);
    // `max_steps` est désormais la LONGUEUR EXACTE N voulue (« Étapes = N »).
    let exact_steps = max_steps
        .unwrap_or(DEFAULT_MAX_STEPS)
        .clamp(1, MAX_STEPS_HARD_CAP);
    let top_n = top_n.unwrap_or(DEFAULT_TOP_N).max(1) as usize;
    let warbond_only = method.as_deref() == Some("longTermSavings");

    if from_ship_id == to_ship_id {
        return Ok(json!({
            "paths": [],
            "totalFound": 0,
            "directCostCents": Value::Null,
            "bestSavingCents": Value::Null,
            "truncated": false,
        }));
    }

    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // ── loadCcuSkuData : warbondSkuIds + priceByShipId (prix standard = MAX SKU). ──
    let sku_rows = sqlx::query("SELECT skuId, shipId, priceCents FROM CcuSku")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut by_ship: HashMap<i64, Vec<(i64, i64)>> = HashMap::new();
    for r in &sku_rows {
        let sku_id = r.try_get::<i64, _>("skuId").map_err(|e| e.to_string())?;
        let ship_id = r.try_get::<i64, _>("shipId").map_err(|e| e.to_string())?;
        let price = r.try_get::<i64, _>("priceCents").map_err(|e| e.to_string())?;
        by_ship.entry(ship_id).or_default().push((sku_id, price));
    }
    let mut warbond_sku_ids: HashSet<i64> = HashSet::new();
    let mut price_by_ship: HashMap<i64, i64> = HashMap::new();
    for (ship_id, arr) in &by_ship {
        let max_price = arr.iter().map(|(_, p)| *p).max().unwrap_or(0);
        price_by_ship.insert(*ship_id, max_price);
        if arr.len() >= 2 {
            for (sku_id, p) in arr {
                if *p < max_price {
                    warbond_sku_ids.insert(*sku_id);
                }
            }
        }
    }

    // ── buildGraph : collapse des SKU parallèles vers le saut le moins cher par
    //    (from → toShip), marquage isWarbond, filtre onlyAvailable au niveau arête. ──
    let graph_sql = if only_available {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents
         FROM CcuUpgrade cu JOIN CcuSku cs ON cs.skuId = cu.toSkuId
         WHERE cs.available = 1"
    } else {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents
         FROM CcuUpgrade cu JOIN CcuSku cs ON cs.skuId = cu.toSkuId"
    };
    let graph_rows = sqlx::query(graph_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut collapsed: HashMap<i64, HashMap<i64, Edge>> = HashMap::new();
    for row in &graph_rows {
        let from = row.try_get::<i64, _>("fromShipId").map_err(|e| e.to_string())?;
        let to_ship = row.try_get::<i64, _>("toShipId").map_err(|e| e.to_string())?;
        if to_ship == from {
            continue; // pas d'auto-boucle
        }
        let to_sku = row.try_get::<i64, _>("toSkuId").map_err(|e| e.to_string())?;
        let up = row
            .try_get::<i64, _>("upgradePriceCents")
            .map_err(|e| e.to_string())?;
        let sku_price = row
            .try_get::<i64, _>("skuPriceCents")
            .map_err(|e| e.to_string())?;
        // Plancher « saut viable » : ignore les micro-CCU (< $15) pour éviter les chaînes
        // truffées de sauts dérisoires (UTV→X1 à ~$5). On ne garde que des sauts ≥ $15.
        if up < MIN_STEP_CENTS {
            continue;
        }
        let per = collapsed.entry(from).or_default();
        let replace = match per.get(&to_ship) {
            Some(ex) => up < ex.upgrade_price_cents,
            None => true,
        };
        if replace {
            per.insert(
                to_ship,
                Edge {
                    to_ship_id: to_ship,
                    to_sku_id: to_sku,
                    upgrade_price_cents: up,
                    to_sku_price_cents: sku_price,
                    is_warbond: warbond_sku_ids.contains(&to_sku),
                },
            );
        }
    }
    let mut graph: HashMap<i64, Vec<Edge>> = HashMap::new();
    for (from, per) in collapsed {
        let mut edges: Vec<Edge> = per.into_values().collect();
        edges.sort_by_key(|e| e.upgrade_price_cents);
        graph.insert(from, edges);
    }

    // ── Owned set (toujours chargé : sert au filtre ET à l'enrichissement par étape). ──
    let owned_set: HashSet<i64> = {
        let rows = sqlx::query(
            "SELECT DISTINCT sd.rsiShipId
             FROM Ship s JOIN ShipData sd ON sd.name = s.name
             WHERE s.accountId = ? AND sd.rsiShipId IS NOT NULL",
        )
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        rows.iter()
            .filter_map(|r| r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten())
            .collect()
    };

    // ── Coût direct (arête directe la moins chère, INDÉPENDANT des filtres). ──
    let direct_cost_cents: Option<i64> = sqlx::query(
        "SELECT MIN(cu.upgradePriceCents) as m
         FROM CcuUpgrade cu JOIN CcuSku cs ON cs.skuId = cu.toSkuId
         WHERE cu.fromShipId = ? AND cs.shipId = ?",
    )
    .bind(from_ship_id)
    .bind(to_ship_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .try_get::<Option<i64>, _>("m")
    .ok()
    .flatten();

    // ── DP principal top-K (jusqu'à la longueur EXACTE demandée) ──
    let layers = run_layered_dp(
        &graph,
        &owned_set,
        from_ship_id,
        only_owned_source,
        from_ship_id,
        exact_steps,
        warbond_only,
    );

    // Les K meilleures entrées atteignant la cible en EXACTEMENT `exact_steps` sauts,
    // déjà triées par coût croissant. Vide si aucune chaîne de cette longueur (ex. cible
    // sans SKU = jamais dans le graphe) → on renvoie 0 chemin proprement.
    let exact_entries: Vec<LayerState> = layers[exact_steps as usize]
        .get(&to_ship_id)
        .cloned()
        .unwrap_or_default();

    let mut best: Vec<ChainResultData> = Vec::new();
    let total_found: usize;

    if !warbond_only || !exact_entries.is_empty() {
        // Cas normal (immédiat ; ou long terme joignable en N sauts warbond) : on prend
        // les K meilleures chaînes de longueur EXACTE N, moins chère → plus chère.
        for (idx, end) in exact_entries.iter().enumerate() {
            let Some(steps) = reconstruct_steps(&layers, exact_steps, to_ship_id, idx, &owned_set)
            else {
                continue;
            };
            best.push(ChainResultData {
                steps,
                total_cost: end.cost,
                step_count: exact_steps,
                warbond_end_index: if warbond_only { Some(exact_steps - 1) } else { None },
            });
        }
        total_found = best.len();
        if best.len() > top_n {
            best.truncate(top_n);
        }
    } else {
        // Long terme NON joignable en N sauts warbond : préfixe warbond (kw) + pont
        // standard (N-kw) pour une longueur TOTALE EXACTE = N. Pour chaque découpe kw on
        // prend le meilleur point d'arrêt warbond (économie estimée, coef 1.032) puis les
        // K meilleurs ponts standard de longueur EXACTE (N-kw) vers la cible.
        let from_price = price_by_ship.get(&from_ship_id).copied().unwrap_or(0);
        let to_price = price_by_ship.get(&to_ship_id).copied().unwrap_or(0);
        for kw in 1..exact_steps {
            let ks = exact_steps - kw; // longueur du pont standard
            // Meilleur point d'arrêt warbond à profondeur kw (sur son entrée la moins chère).
            let mut best_endpoint: Option<(i64, i64)> = None; // (shipId, saving)
            for (&ship_id, states) in layers[kw as usize].iter() {
                if ship_id == from_ship_id {
                    continue;
                }
                let Some(&end_price) = price_by_ship.get(&ship_id) else {
                    continue;
                };
                if end_price > to_price {
                    continue;
                }
                let cost = states[0].cost; // entrée la moins chère
                let saving =
                    (STANDARD_MARKUP * (end_price - from_price) as f64).round() as i64 - cost;
                let better = match best_endpoint {
                    None => true,
                    Some((_, bsav)) => saving > bsav,
                };
                if better {
                    best_endpoint = Some((ship_id, saving));
                }
            }
            let Some((endpoint_ship, _saving)) = best_endpoint else {
                continue;
            };
            let Some(warbond_steps) = reconstruct_steps(&layers, kw, endpoint_ship, 0, &owned_set)
            else {
                continue;
            };
            // Pont standard : K meilleurs de longueur EXACTE ks depuis endpoint → cible.
            let layers2 = run_layered_dp(
                &graph,
                &owned_set,
                from_ship_id,
                only_owned_source,
                endpoint_ship,
                ks,
                false,
            );
            let std_entries: Vec<LayerState> = layers2[ks as usize]
                .get(&to_ship_id)
                .cloned()
                .unwrap_or_default();
            for sidx in 0..std_entries.len() {
                let Some(standard_steps) = reconstruct_steps(&layers2, ks, to_ship_id, sidx, &owned_set)
                else {
                    continue;
                };
                let mut combined = warbond_steps.clone();
                let warbond_end_index = combined.len() as i64 - 1;
                combined.extend(standard_steps);
                let total_cost: i64 = combined.iter().map(|s| s.upgrade_price_cents).sum();
                let step_count = combined.len() as i64;
                best.push(ChainResultData {
                    steps: combined,
                    total_cost,
                    step_count,
                    warbond_end_index: Some(warbond_end_index),
                });
            }
        }
        best.sort_by(|a, b| a.total_cost.cmp(&b.total_cost));
        total_found = best.len();
        if best.len() > top_n {
            best.truncate(top_n);
        }
    }

    let paths: Vec<Value> = best
        .iter()
        .map(|r| {
            let saving = direct_cost_cents.map(|d| d - r.total_cost);
            json!({
                "steps": r.steps,
                "totalCostCents": r.total_cost,
                "stepCount": r.step_count,
                "directCostCents": direct_cost_cents,
                "savingCents": saving,
                "warbondEndIndex": r.warbond_end_index,
            })
        })
        .collect();

    let best_saving_cents: Option<i64> = best
        .first()
        .and_then(|r| direct_cost_cents.map(|d| d - r.total_cost));

    Ok(json!({
        "paths": paths,
        "totalFound": total_found,
        "directCostCents": direct_cost_cents,
        "bestSavingCents": best_saving_cents,
        "truncated": false,
    }))
}

/* ══════════════════════════════════════════════════════════════════════════════
   LOT 1 — SYNC COMPLET DU CATALOGUE CCU (port fidèle de la V1 ccuSyncService).

   Réutilise la webview `rsi-login` ouverte par le front (comme le scrape hangar :
   session persistante dataDirectory rsi-<handle>, déjà connectée avant l'appel).
   Rsi-Token étant HttpOnly, il est lu côté Rust (cookie store) puis injecté dans
   le JS. csrf-token est lu dans le DOM (<meta>). Chaque appel filterShips tourne
   in-page (fetch credentials:include) et dépose son résultat dans `window.__ccuProbe` ;
   le Rust SONDE ce nœud (relais async — eval n'attend pas la promesse).

   Séquence (identique V1) :
     1. setAuthToken {} + setContextToken(null) + filterShips(null) → catalogue :
        to.ships → CcuSku + RsiShipName ; from.ships → liste des ~238 fromShipId.
     2. boucle fromId : setContextToken(fromId) + filterShips(fromId) → CcuUpgrade
        (200 ms entre appels, abandon après 10 erreurs consécutives, annulable).
     3. pruning doux : SKU disparus → available=false (jamais supprimés, FK).
   Idempotent (upsert). Émet `ccu:sync-progress` {current,total}. AppMeta ccu.lastSyncAt.
   ═════════════════════════════════════════════════════════════════════════════ */

/// Drapeau d'annulation (un seul sync à la fois). Mis à true par `cancel_ccu_sync`,
/// remis à false au début de `sync_ccu_catalog`, lu à chaque itération de la boucle.
static CCU_SYNC_CANCEL: AtomicBool = AtomicBool::new(false);

const RSI_ORIGIN: &str = "https://robertsspaceindustries.com";

/// Poll de navigation : READY dès que la page pledges est chargée (meta csrf
/// présente), LOGIN si redirigé vers la connexion / session expirée, sinon PENDING.
const CCU_NAV_POLL: &str = r#"(function(){
  try {
    var u = location.href;
    if (/\/(login|signin|connect|sign-in)/.test(u)) return 'LOGIN';
    var b = (document.body && document.body.textContent) ? document.body.textContent.toLowerCase() : '';
    if (b.indexOf('session has expired') !== -1) return 'LOGIN';
    var m = document.querySelector('meta[name="csrf-token"]');
    if (m && m.getAttribute('content')) return 'READY';
    return 'PENDING';
  } catch(e){ return 'ERROR:' + e.message; }
})()"#;

/// Poll du relais async : la valeur déposée par le kick-off (PENDING tant que les
/// fetch ne sont pas finis).
const CCU_PROBE_POLL: &str =
    r#"(function(){ try { return window.__ccuProbe || 'PENDING'; } catch(e){ return 'ERROR:' + e.message; } })()"#;

/// Template du kick-off in-page (paramétré par `build_kickoff`). Lit csrf (DOM),
/// enchaîne (setAuthToken si catalogue) + setContextToken + filterShips, puis dépose
/// `out` (toShips bruts + éventuels fromIds) dans window.__ccuProbe. Placeholders
/// remplacés côté Rust : __RSI_TOKEN__, __SETAUTH__, __CTX_BODY__, __VARS__, __COLLECT_FROM__.
const CCU_KICKOFF_TEMPLATE: &str = r##"(function(){
  try {
    window.__ccuProbe = 'PENDING';
    var meta = document.querySelector('meta[name="csrf-token"]');
    var csrf = meta ? meta.getAttribute('content') : null;
    if (!csrf) { window.__ccuProbe = 'ERROR:no-csrf'; return 'started'; }
    var rsiToken = '__RSI_TOKEN__';
    var authHeaders = { 'content-type':'application/json;charset=UTF-8', 'accept':'application/json', 'x-rsi-token': rsiToken };
    var gqlHeaders = { 'content-type':'application/json', 'x-csrf-token': csrf };
    var query = `query filterShips($fromId: Int, $toId: Int, $fromFilters: [FilterConstraintValues], $toFilters: [FilterConstraintValues]) {
  from(to: $toId, filters: $fromFilters) { ships { id name } }
  to(from: $fromId, filters: $toFilters) {
    ships { id name skus { id price upgradePrice unlimitedStock showStock available availableStock } } }
}`;
    (async function(){
      try {
        __SETAUTH__
        var rc = await fetch('https://robertsspaceindustries.com/api/ship-upgrades/setContextToken', { method:'POST', headers:authHeaders, credentials:'include', body: '__CTX_BODY__' });
        var r3 = await fetch('https://robertsspaceindustries.com/pledge-store/api/upgrade/v2/graphql', { method:'POST', headers:gqlHeaders, credentials:'include', body: JSON.stringify({ operationName:'filterShips', variables: __VARS__, query: query }) });
        var t3 = await r3.text();
        var j = null; try { j = JSON.parse(t3); } catch(e){}
        var to = (j && j.data && j.data.to && j.data.to.ships) || [];
        var from = (j && j.data && j.data.from && j.data.from.ships) || [];
        var out = {
          ok: (r3.status === 200) && !(j && j.errors),
          ctxStatus: rc.status,
          httpStatus: r3.status,
          gqlErrors: (j && j.errors) ? JSON.stringify(j.errors).slice(0,300) : null,
          toShips: to,
          rawSnippet: j ? null : (t3 || '').slice(0,300)
        };
        __COLLECT_FROM__
        window.__ccuProbe = JSON.stringify(out);
      } catch(err) { window.__ccuProbe = 'ERROR:fetch:' + String(err); }
    })();
    return 'started';
  } catch(e){ window.__ccuProbe = 'ERROR:init:' + e.message; return 'started'; }
})()"##;

/// Construit le kick-off pour un appel filterShips. `from_id == None` = appel
/// catalogue (setAuthToken + collecte de from.ships id+name) ; `Some(id)` = appel par vaisseau
/// de départ (setContextToken(id) + filterShips(id)). Headers/bodies identiques V1.
fn build_kickoff(token: &str, from_id: Option<i64>) -> String {
    let (ctx_body, vars, set_auth, collect_from): (String, String, &str, &str) = match from_id {
        None => (
            r#"{"fromShipId":null,"toShipId":null,"toSkuId":null,"pledgeId":null}"#.to_string(),
            "{ fromFilters:[], toFilters:[] }".to_string(),
            "await fetch('https://robertsspaceindustries.com/api/account/v2/setAuthToken', { method:'POST', headers:authHeaders, credentials:'include', body:'{}' });",
            "out.fromShips = from.map(function(s){ return { id: s.id, name: s.name || null }; });",
        ),
        Some(id) => (
            format!(r#"{{"fromShipId":{id},"toShipId":null,"toSkuId":null,"pledgeId":null}}"#),
            format!("{{ fromId:{id}, fromFilters:[], toFilters:[] }}"),
            "",
            "",
        ),
    };
    CCU_KICKOFF_TEMPLATE
        .replace("__RSI_TOKEN__", token)
        .replace("__SETAUTH__", set_auth)
        .replace("__CTX_BODY__", &ctx_body)
        .replace("__VARS__", &vars)
        .replace("__COLLECT_FROM__", collect_from)
}

/// Évalue un JS (dynamique, ex. token injecté) dans la webview et déballe le
/// résultat. Comme `auth.rs`/`rsi_scrape.rs` : spawn_blocking obligatoire car sur
/// Windows WebView2 `eval_with_callback` interbloque sur le thread principal.
async fn ccu_eval(win: tauri::WebviewWindow, js: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel::<String>();
        win.eval_with_callback(js.as_str(), move |v| {
            let _ = tx.send(v);
        })
        .map_err(|e| e.to_string())?;
        let raw = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "eval timeout".to_string())?;
        Ok(serde_json::from_str::<String>(&raw).unwrap_or(raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Un appel filterShips complet via la webview : kick-off in-page → relais async.
/// Renvoie l'objet `out` (toShips, ok, fromIds…). Err = relais cassé / timeout / parse.
async fn run_filter_ships(
    win: &tauri::WebviewWindow,
    token: &str,
    from_id: Option<i64>,
) -> Result<Value, String> {
    let kickoff = build_kickoff(token, from_id);
    ccu_eval(win.clone(), kickoff).await?;

    let probe_start = Instant::now();
    loop {
        if probe_start.elapsed() > Duration::from_secs(30) {
            return Err("relais async : __ccuProbe resté PENDING 30 s".to_string());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        let s = ccu_eval(win.clone(), CCU_PROBE_POLL.to_string()).await?;
        if s == "PENDING" || s == "started" {
            continue;
        }
        if s.starts_with("ERROR") {
            return Err(s);
        }
        return serde_json::from_str::<Value>(&s).map_err(|e| format!("parse __ccuProbe : {e}"));
    }
}

/// Upsert d'un CcuSku — mapping identique à `buildSkuUpsert` V1 (availableStock pris
/// uniquement si showStock vrai, sinon NULL). Idempotent.
async fn upsert_ccu_sku(pool: &sqlx::SqlitePool, ship_id: i64, sku: &Value) -> Result<(), String> {
    let Some(sku_id) = sku.get("id").and_then(|v| v.as_i64()) else {
        return Ok(());
    };
    let price = sku.get("price").and_then(|v| v.as_i64()).unwrap_or(0);
    let available = sku.get("available").and_then(|v| v.as_bool()).unwrap_or(false) as i64;
    let unlimited = sku
        .get("unlimitedStock")
        .and_then(|v| v.as_bool())
        .unwrap_or(false) as i64;
    let show_stock = sku.get("showStock").and_then(|v| v.as_bool()).unwrap_or(false);
    let available_stock: Option<i64> = if show_stock {
        sku.get("availableStock").and_then(|v| v.as_i64())
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO CcuSku (skuId, shipId, priceCents, available, unlimitedStock, availableStock, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(skuId) DO UPDATE SET
           shipId = excluded.shipId, priceCents = excluded.priceCents,
           available = excluded.available, unlimitedStock = excluded.unlimitedStock,
           availableStock = excluded.availableStock, updatedAt = datetime('now')",
    )
    .bind(sku_id)
    .bind(ship_id)
    .bind(price)
    .bind(available)
    .bind(unlimited)
    .bind(available_stock)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Drapeau d'annulation depuis le front (bouton « Annuler »). Lu par la boucle.
#[tauri::command]
pub async fn cancel_ccu_sync() -> Result<(), String> {
    CCU_SYNC_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Sync complet du catalogue CCU. Le FRONT ouvre la webview rsi-login (session
/// persistante du compte) + attend logged_in AVANT d'invoquer (comme le scrape hangar).
#[tauri::command]
pub async fn sync_ccu_catalog(
    app: AppHandle,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    CCU_SYNC_CANCEL.store(false, Ordering::SeqCst);
    let started = Instant::now();

    // Pool cloné (Arc interne) → aucun verrou DbInstances tenu pendant les minutes de webview.
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

    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre RSI absente — lance la synchro depuis Settings.".to_string())?;

    // 1. Page pledges prête (csrf meta présente) ; LOGIN → session expirée.
    let url = tauri::Url::parse("https://robertsspaceindustries.com/en/account/pledges")
        .map_err(|e| e.to_string())?;
    win.navigate(url.clone()).map_err(|e| e.to_string())?;
    // Fenêtre invisible pendant le sync : on la sort de l'écran APRÈS navigate (qui,
    // sur WebView2, ré-affiche/rescue une fenêtre que le front aurait cachée/déplacée).
    // La position est réappliquée après chaque re-navigate (sinon défaite à nouveau).
    let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));
    let nav_start = Instant::now();
    let mut last_reload = Instant::now();
    let mut ready = false;
    while nav_start.elapsed() < Duration::from_secs(90) {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let s = ccu_eval(win.clone(), CCU_NAV_POLL.to_string()).await?;
        if s == "READY" {
            ready = true;
            break;
        }
        if s == "LOGIN" {
            return Err("Session RSI expirée — reconnecte-toi à RSI.".to_string());
        }
        if last_reload.elapsed() >= Duration::from_secs(20) {
            let _ = win.navigate(url.clone());
            let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));
            last_reload = Instant::now();
        }
    }
    if !ready {
        return Err("Page pledges non chargée en 90 s (challenge Cloudflare ?).".to_string());
    }

    // 2. Rsi-Token (HttpOnly) lu côté Rust.
    let origin = tauri::Url::parse(RSI_ORIGIN).map_err(|e| e.to_string())?;
    let token = win
        .cookies_for_url(origin)
        .map_err(|e| e.to_string())?
        .iter()
        .find(|c| c.name() == "Rsi-Token" && !c.value().is_empty())
        .map(|c| c.value().to_string())
        .ok_or_else(|| "Rsi-Token introuvable (session ?).".to_string())?;

    let mut known_sku_ids: HashSet<i64> = HashSet::new();
    let mut names_count: i64 = 0;
    let mut upgrades_count: i64 = 0;
    let mut errors: i64 = 0;

    // 3. Appel catalogue (fromId = null) → CcuSku + RsiShipName + liste des fromShipId.
    let catalog = run_filter_ships(&win, &token, None).await?;
    if !catalog.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let status = catalog.get("httpStatus").and_then(|v| v.as_i64()).unwrap_or(0);
        let detail = catalog.get("gqlErrors").and_then(|v| v.as_str()).unwrap_or("");
        return Err(format!(
            "filterShips (catalogue) a échoué — HTTP {status} {detail}"
        ));
    }
    if let Some(ships) = catalog.get("toShips").and_then(|v| v.as_array()) {
        for ship in ships {
            let Some(ship_id) = ship.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            if let Some(name) = ship.get("name").and_then(|v| v.as_str()) {
                let name = name.trim();
                if !name.is_empty() {
                    sqlx::query(
                        "INSERT INTO RsiShipName (shipId, name, updatedAt) VALUES (?, ?, datetime('now'))
                         ON CONFLICT(shipId) DO UPDATE SET name = excluded.name, updatedAt = datetime('now')",
                    )
                    .bind(ship_id)
                    .bind(name)
                    .execute(&pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    names_count += 1;
                }
            }
            if let Some(skus) = ship.get("skus").and_then(|v| v.as_array()) {
                for sku in skus {
                    if let Some(sku_id) = sku.get("id").and_then(|v| v.as_i64()) {
                        upsert_ccu_sku(&pool, ship_id, sku).await?;
                        known_sku_ids.insert(sku_id);
                    }
                }
            }
        }
    }

    // from.ships porte désormais id + name → on peuple RsiShipName pour les vaisseaux
    // SOURCE-SEULEMENT (jamais une cible to.ships, donc jamais nommés autrement) et on
    // en dérive la liste des fromShipId à itérer.
    let mut from_ids: Vec<i64> = Vec::new();
    if let Some(from_ships) = catalog.get("fromShips").and_then(|v| v.as_array()) {
        for fs in from_ships {
            let Some(id) = fs.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            from_ids.push(id);
            if let Some(name) = fs.get("name").and_then(|v| v.as_str()) {
                let name = name.trim();
                if !name.is_empty() {
                    sqlx::query(
                        "INSERT INTO RsiShipName (shipId, name, updatedAt) VALUES (?, ?, datetime('now'))
                         ON CONFLICT(shipId) DO UPDATE SET name = excluded.name, updatedAt = datetime('now')",
                    )
                    .bind(id)
                    .bind(name)
                    .execute(&pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    names_count += 1;
                }
            }
        }
    }
    let total = from_ids.len() as i64;
    eprintln!(
        "[ccu-sync] catalogue : {} SKU, {} noms ; {} fromShipId à itérer",
        known_sku_ids.len(),
        names_count,
        total
    );

    // 4. Boucle séquentielle par vaisseau de départ → CcuUpgrade.
    let mut consecutive_errors: i64 = 0;
    let mut processed: i64 = 0;
    let mut cancelled = false;
    for (i, &from_id) in from_ids.iter().enumerate() {
        if CCU_SYNC_CANCEL.load(Ordering::SeqCst) {
            cancelled = true;
            eprintln!("[ccu-sync] annulé à {i}/{total} — arrêt propre");
            break;
        }

        match run_filter_ships(&win, &token, Some(from_id)).await {
            Ok(out) if out.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) => {
                if let Some(ships) = out.get("toShips").and_then(|v| v.as_array()) {
                    for ship in ships {
                        let Some(ship_id) = ship.get("id").and_then(|v| v.as_i64()) else {
                            continue;
                        };
                        if let Some(skus) = ship.get("skus").and_then(|v| v.as_array()) {
                            for sku in skus {
                                let Some(sku_id) = sku.get("id").and_then(|v| v.as_i64()) else {
                                    continue;
                                };
                                let Some(up) = sku.get("upgradePrice").and_then(|v| v.as_i64())
                                else {
                                    continue;
                                };
                                // FK : garantir la présence du CcuSku parent avant le CcuUpgrade.
                                if !known_sku_ids.contains(&sku_id) {
                                    upsert_ccu_sku(&pool, ship_id, sku).await?;
                                    known_sku_ids.insert(sku_id);
                                }
                                sqlx::query(
                                    "INSERT INTO CcuUpgrade (fromShipId, toSkuId, upgradePriceCents, updatedAt)
                                     VALUES (?, ?, ?, datetime('now'))
                                     ON CONFLICT(fromShipId, toSkuId) DO UPDATE SET
                                       upgradePriceCents = excluded.upgradePriceCents, updatedAt = datetime('now')",
                                )
                                .bind(from_id)
                                .bind(sku_id)
                                .bind(up)
                                .execute(&pool)
                                .await
                                .map_err(|e| e.to_string())?;
                                upgrades_count += 1;
                            }
                        }
                    }
                }
                consecutive_errors = 0;
            }
            Ok(out) => {
                errors += 1;
                consecutive_errors += 1;
                let status = out.get("httpStatus").and_then(|v| v.as_i64()).unwrap_or(0);
                let detail = out.get("gqlErrors").and_then(|v| v.as_str()).unwrap_or("");
                eprintln!("[ccu-sync] erreur fromShipId={from_id} — HTTP {status} {detail}");
            }
            Err(e) => {
                errors += 1;
                consecutive_errors += 1;
                eprintln!("[ccu-sync] erreur fromShipId={from_id} — {e}");
            }
        }

        if consecutive_errors > 10 {
            return Err(format!(
                "Abandon : {consecutive_errors} erreurs consécutives (dernière à fromShipId={from_id})."
            ));
        }

        processed = (i as i64) + 1;
        let _ = app.emit(
            "ccu:sync-progress",
            json!({ "current": processed, "total": total, "fromShipId": from_id }),
        );

        if (i as i64) < total - 1 && !CCU_SYNC_CANCEL.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    // 5. Pruning doux : SKU disparus du catalogue → available=false (jamais supprimés).
    // Ignoré si annulé (knownSkuIds partiel marquerait à tort des SKU valides).
    let mut pruned: u64 = 0;
    if !cancelled && !known_sku_ids.is_empty() {
        let ids = known_sku_ids
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "UPDATE CcuSku SET available = 0, updatedAt = datetime('now') WHERE available = 1 AND skuId NOT IN ({ids})"
        );
        let res = sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        pruned = res.rows_affected();
        eprintln!("[ccu-sync] pruning — {pruned} SKU marqués indisponibles (disparus du catalogue)");
    } else {
        eprintln!("[ccu-sync] pruning ignoré — sync interrompue ou aucun SKU");
    }

    // 6. AppMeta lastSyncAt (seulement si sync complète).
    if !cancelled {
        sqlx::query(
            "INSERT OR REPLACE INTO AppMeta (key, value) VALUES ('ccu.lastSyncAt', datetime('now'))",
        )
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    let duration_ms = started.elapsed().as_millis() as i64;
    eprintln!(
        "[ccu-sync] terminé — {} SKU, {} upgrades, {} noms, {} erreurs, {} ms{}",
        known_sku_ids.len(),
        upgrades_count,
        names_count,
        errors,
        duration_ms,
        if cancelled { " (annulé)" } else { "" }
    );

    Ok(json!({
        "skusCount": known_sku_ids.len(),
        "upgradesCount": upgrades_count,
        "namesCount": names_count,
        "errors": errors,
        "durationMs": duration_ms,
        "cancelled": cancelled,
        "total": total,
        "processed": processed,
        "pruned": pruned,
    }))
}
