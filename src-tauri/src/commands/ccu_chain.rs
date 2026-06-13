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

#[tauri::command]
pub async fn get_ccu_ships_metadata(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Vaisseaux possédés (par nom) du compte actif → pour isOwned.
    let owned_rows = sqlx::query("SELECT DISTINCT s.name FROM Ship s WHERE s.accountId = ?")
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let owned_names: HashSet<String> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .collect();

    let rows = sqlx::query(
        "SELECT
           sd.rsiShipId as shipId,
           sd.name,
           sd.manufacturer,
           sd.focus,
           sd.imageUrl,
           sd.msrpUsd,
           MIN(cs.priceCents) as cheapestPriceCents,
           CASE WHEN SUM(CASE WHEN cs.available = 1 THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END as isAvailable
         FROM ShipData sd
         LEFT JOIN CcuSku cs ON cs.shipId = sd.rsiShipId
         WHERE sd.rsiShipId IS NOT NULL
         GROUP BY sd.rsiShipId, sd.name, sd.manufacturer, sd.focus, sd.imageUrl, sd.msrpUsd",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let ship_id = row.try_get::<i64, _>("shipId").map_err(|e| e.to_string())?;
        let name = row.try_get::<String, _>("name").map_err(|e| e.to_string())?;
        let manufacturer = row.try_get::<Option<String>, _>("manufacturer").ok().flatten();
        let focus = row
            .try_get::<Option<String>, _>("focus")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty());
        let image_url = row.try_get::<Option<String>, _>("imageUrl").ok().flatten();
        let msrp_usd = row.try_get::<Option<i64>, _>("msrpUsd").ok().flatten();
        let cheapest = row.try_get::<Option<i64>, _>("cheapestPriceCents").ok().flatten();
        let is_available = row.try_get::<i64, _>("isAvailable").unwrap_or(0) == 1;

        // priceCents : CcuSku le moins cher, sinon msrpUsd*100, sinon null.
        let (price_cents, price_source): (Option<i64>, Option<&str>) = match cheapest {
            Some(c) => (Some(c), Some("ccu")),
            None => match msrp_usd {
                Some(m) => (Some(m * 100), Some("msrp")),
                None => (None, None),
            },
        };

        out.push(json!({
            "shipId": ship_id,
            "name": name,
            "manufacturer": manufacturer,
            "focus": focus,
            "imageUrl": image_url,
            "priceCents": price_cents,
            "priceSource": price_source,
            "isOwned": owned_names.contains(&name),
            "isAvailable": is_available,
        }));
    }

    Ok(out)
}

/* ─────────────────────────────  find_ccu_paths  ──────────────────────────── */

struct Edge {
    to_ship_id: i64,
    to_sku_id: i64,
    upgrade_price_cents: i64,
    sku_price_cents: i64,
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
}

struct Frame {
    current: i64,
    steps: Vec<StepData>,
    total_cost: i64,
    visited: HashSet<i64>,
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
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let only_available = only_available.unwrap_or(false);
    let only_owned_source = only_owned_source.unwrap_or(false);
    let max_steps = max_steps.unwrap_or(5).min(8).max(1);
    let top_n = top_n.unwrap_or(30).max(1) as usize;

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

    // Étape A — charger le graphe en une requête.
    let graph_sql = if only_available {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents, cs.available
         FROM CcuUpgrade cu
         JOIN CcuSku cs ON cs.skuId = cu.toSkuId
         WHERE cs.available = 1"
    } else {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents, cs.available
         FROM CcuUpgrade cu
         JOIN CcuSku cs ON cs.skuId = cu.toSkuId"
    };

    let graph_rows = sqlx::query(graph_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut graph: HashMap<i64, Vec<Edge>> = HashMap::new();
    for row in &graph_rows {
        let from = row.try_get::<i64, _>("fromShipId").map_err(|e| e.to_string())?;
        let edge = Edge {
            to_ship_id: row.try_get::<i64, _>("toShipId").map_err(|e| e.to_string())?,
            to_sku_id: row.try_get::<i64, _>("toSkuId").map_err(|e| e.to_string())?,
            upgrade_price_cents: row
                .try_get::<i64, _>("upgradePriceCents")
                .map_err(|e| e.to_string())?,
            sku_price_cents: row
                .try_get::<i64, _>("skuPriceCents")
                .map_err(|e| e.to_string())?,
        };
        graph.entry(from).or_default().push(edge);
    }

    // Étape B — ships possédés (rsiShipId) si filtre only_owned_source.
    let owned_ids: HashSet<i64> = if only_owned_source {
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
    } else {
        HashSet::new()
    };

    // Étape C — DFS borné.
    let mut found: Vec<(Vec<StepData>, i64)> = Vec::new();
    let mut stack: Vec<Frame> = vec![Frame {
        current: from_ship_id,
        steps: Vec::new(),
        total_cost: 0,
        visited: HashSet::from([from_ship_id]),
    }];

    while let Some(frame) = stack.pop() {
        let Some(edges) = graph.get(&frame.current) else {
            continue;
        };
        for edge in edges {
            if frame.visited.contains(&edge.to_ship_id) {
                continue; // évite les cycles
            }
            // Filtre source possédée : seul le vaisseau de départ doit être possédé.
            if only_owned_source && frame.steps.is_empty() && !owned_ids.contains(&from_ship_id) {
                continue;
            }

            let mut new_steps = frame.steps.clone();
            new_steps.push(StepData {
                from_ship_id: frame.current,
                to_ship_id: edge.to_ship_id,
                to_sku_id: edge.to_sku_id,
                to_sku_price_cents: edge.sku_price_cents,
                upgrade_price_cents: edge.upgrade_price_cents,
            });
            let new_cost = frame.total_cost + edge.upgrade_price_cents;

            if edge.to_ship_id == to_ship_id {
                found.push((new_steps, new_cost));
            } else if new_steps.len() < max_steps as usize {
                let mut visited = frame.visited.clone();
                visited.insert(edge.to_ship_id);
                stack.push(Frame {
                    current: edge.to_ship_id,
                    steps: new_steps,
                    total_cost: new_cost,
                    visited,
                });
            }
        }
    }

    // Étape D — coût direct (arête directe la moins chère from→to).
    let direct_cost_cents: Option<i64> = graph.get(&from_ship_id).and_then(|edges| {
        edges
            .iter()
            .filter(|e| e.to_ship_id == to_ship_id)
            .map(|e| e.upgrade_price_cents)
            .min()
    });

    // Étape F — tri par coût croissant, troncature top_n.
    found.sort_by_key(|(_, cost)| *cost);
    let total_found = found.len();
    let truncated = total_found > top_n;
    found.truncate(top_n);

    // Étapes E + sérialisation.
    let paths: Vec<Value> = found
        .iter()
        .map(|(steps, total)| {
            let saving = direct_cost_cents.map(|d| d - total);
            json!({
                "steps": steps,
                "totalCostCents": total,
                "stepCount": steps.len(),
                "directCostCents": direct_cost_cents,
                "savingCents": saving,
            })
        })
        .collect();

    // La meilleure économie correspond au chemin le moins cher (premier après tri).
    let best_saving_cents: Option<i64> = found
        .first()
        .and_then(|(_, total)| direct_cost_cents.map(|d| d - total));

    Ok(json!({
        "paths": paths,
        "totalFound": total_found,
        "directCostCents": direct_cost_cents,
        "bestSavingCents": best_saving_cents,
        "truncated": truncated,
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
  from(to: $toId, filters: $fromFilters) { ships { id } }
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
/// catalogue (setAuthToken + collecte des fromIds) ; `Some(id)` = appel par vaisseau
/// de départ (setContextToken(id) + filterShips(id)). Headers/bodies identiques V1.
fn build_kickoff(token: &str, from_id: Option<i64>) -> String {
    let (ctx_body, vars, set_auth, collect_from): (String, String, &str, &str) = match from_id {
        None => (
            r#"{"fromShipId":null,"toShipId":null,"toSkuId":null,"pledgeId":null}"#.to_string(),
            "{ fromFilters:[], toFilters:[] }".to_string(),
            "await fetch('https://robertsspaceindustries.com/api/account/v2/setAuthToken', { method:'POST', headers:authHeaders, credentials:'include', body:'{}' });",
            "out.fromIds = from.map(function(s){ return s.id; });",
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

    let from_ids: Vec<i64> = catalog
        .get("fromIds")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();
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
