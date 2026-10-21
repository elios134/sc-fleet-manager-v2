// Recherche des chaînes CCU (programmation dynamique par couches) et commande find_ccu_paths.
use super::*;

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

pub(crate) const MAX_STEPS_HARD_CAP: i64 = 15;
pub(crate) const DEFAULT_MAX_STEPS: i64 = 5;
pub(crate) const DEFAULT_TOP_N: i64 = 30;
/// Coefficient de surcoût standard (confirmé = 1.032 sur toute la matrice CCU).
/// Sert à estimer l'économie du point d'arrêt warbond (stratégie long terme).
pub(crate) const STANDARD_MARKUP: f64 = 1.032;

/// Saut minimum « viable » : on ignore les CCU dont le prix d'upgrade est inférieur à ce
/// seuil, pour ne pas produire de chaînes truffées de micro-sauts dérisoires (UTV→X1 à ~$5).
/// 1500 = $15.00 (laisse passer le 1er palier réel $15.48 = $15 × markup 1.032).
pub(crate) const MIN_STEP_CENTS: i64 = 1500;
/// Largeur de la DP par couches : on garde les K meilleurs coûts par (nœud, profondeur),
/// ce qui suffit (DAG strict de prix) à obtenir les K meilleures chaînes à la cible pour
/// une longueur exacte donnée. Diagnostic : < 0.3 ms jusqu'à N=8, top-5 exact.
pub(crate) const LAYER_TOP_K: usize = 5;

#[derive(Clone)]
pub(crate) struct Edge {
    pub(crate) to_ship_id: i64,
    pub(crate) to_sku_id: i64,
    pub(crate) upgrade_price_cents: i64,
    pub(crate) to_sku_price_cents: i64,
    // True si l'arête vise le SKU le moins cher d'un vaisseau multi-SKU (= warbond).
    pub(crate) is_warbond: bool,
}

#[derive(Clone)]
pub(crate) struct LayerState {
    pub(crate) cost: i64,
    pub(crate) prev_ship_id: Option<i64>,
    // Index de l'entrée parente dans layers[depth-1][prev_ship_id] : permet de
    // reconstruire des chaînes DISTINCTES quand un nœud porte plusieurs prédécesseurs.
    pub(crate) prev_index: Option<usize>,
    pub(crate) edge: Option<Edge>,
}

#[derive(Clone, Serialize)]
pub(crate) struct StepData {
    #[serde(rename = "fromShipId")]
    pub(crate) from_ship_id: i64,
    #[serde(rename = "toShipId")]
    pub(crate) to_ship_id: i64,
    #[serde(rename = "toSkuId")]
    pub(crate) to_sku_id: i64,
    #[serde(rename = "toSkuPriceCents")]
    pub(crate) to_sku_price_cents: i64,
    #[serde(rename = "upgradePriceCents")]
    pub(crate) upgrade_price_cents: i64,
    #[serde(rename = "isOwnedSourceShip")]
    pub(crate) is_owned_source_ship: bool,
}

/// DP par couches top-K : couche[k][shipId] = les K meilleurs coûts (triés croissants)
/// pour atteindre shipId en EXACTEMENT k sauts depuis source_ship_id, chacun avec un
/// back-pointer (prev_ship_id, prev_index) vers l'entrée parente → chaînes distinctes.
/// `warbond_filter` ne suit que les arêtes warbond. Le filtre « depuis mes vaisseaux »
/// exempte toujours le from choisi par l'utilisateur (les sources intermédiaires choisies
/// par l'algo doivent, elles, être possédées). Réutilisé pour le complément standard.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_layered_dp(
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
pub(crate) fn reconstruct_steps(
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

pub(crate) struct ChainResultData {
    pub(crate) steps: Vec<StepData>,
    pub(crate) total_cost: i64,
    pub(crate) step_count: i64,
    pub(crate) warbond_end_index: Option<i64>,
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
        best.sort_by_key(|a| a.total_cost);
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
