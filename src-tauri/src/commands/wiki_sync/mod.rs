use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";

// Robustesse réseau (réplique V1 scWikiSync.ts).
const RATE_LIMIT_DELAY_MS: u64 = 100;
const REQUEST_TIMEOUT_SECS: u64 = 15;
const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY_MS: u64 = 500;

// ── Plafonds (SYNC COMPLÈTE) ──
// Pour repasser en échantillon de test : MAX_DETAIL_FETCH = Some(10).
// Nombre maximum d'appels détail (None = illimité). Limite vaisseaux + hardpoints.
// En mode échantillon, les vaisseaux de la flotte sont priorisés (cf. sync_ship_data)
// pour garantir que le test Loadout Planner trouve des slots sur un vaisseau possédé.
const MAX_DETAIL_FETCH: Option<usize> = None;
/// Ne récupère que la 1ʳᵉ page de la LISTE de stubs (uuid). Laisser false : la liste est
/// légère (~4 requêtes) et doit couvrir toute la flotte pour la priorisation.
const SAMPLE_FIRST_PAGE_ONLY: bool = false;

/* ──────────────────────────────  Réseau  ──────────────────────────────────── */

/// GET JSON avec retries : 429 → respecte Retry-After ; 5xx / erreur réseau → backoff
/// exponentiel (500 ms, 1 s, 2 s) ; 3 tentatives max.
async fn fetch_with_retry(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match client.get(url).send().await {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return r.json::<Value>().await.map_err(|e| e.to_string());
                }
                if status.as_u16() == 429 && attempt < MAX_RETRIES {
                    let retry_after = r
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(1);
                    tokio::time::sleep(Duration::from_secs(retry_after)).await;
                    continue;
                }
                if status.is_server_error() && attempt < MAX_RETRIES {
                    let delay = RETRY_BASE_DELAY_MS * (1 << (attempt - 1));
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    continue;
                }
                return Err(format!("HTTP {status} sur {url}"));
            }
            Err(e) => {
                if attempt < MAX_RETRIES {
                    let delay = RETRY_BASE_DELAY_MS * (1 << (attempt - 1));
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    continue;
                }
                return Err(e.to_string());
            }
        }
    }
}

/* ──────────────────────────────  Extracteurs  ─────────────────────────────── */

/// String non vide pour une clé d'un objet JSON.
fn vstr(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Nombre flottant pour une clé.
fn vf64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

/// Entier pour une clé (accepte un flottant, tronqué).
fn vi64(v: &Value, key: &str) -> Option<i64> {
    v.get(key)
        .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
}

/// Booléen pour une clé (absent → false).
fn vbool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Booléen optionnel pour une clé (absent → None).
fn vbool_opt(v: &Value, key: &str) -> Option<bool> {
    v.get(key).and_then(|x| x.as_bool())
}

/// foci[0] → texte : si string, telle quelle ; si objet, `en_EN` (sinon `name`).
fn extract_focus(v: &Value) -> String {
    let Some(first) = v
        .get("foci")
        .and_then(|f| f.as_array())
        .and_then(|a| a.first())
    else {
        return String::new();
    };
    if let Some(s) = first.as_str() {
        return s.trim().to_string();
    }
    if let Some(s) = first.get("en_EN").and_then(|x| x.as_str()) {
        return s.trim().to_string();
    }
    if let Some(s) = first.get("name").and_then(|x| x.as_str()) {
        return s.trim().to_string();
    }
    String::new()
}

/// Synchronise le catalogue de vaisseaux SC Wiki → table ShipData.
/// PHASE 1 (échantillon) : vaisseaux seuls (pas de hardpoints/composants), plafonné par
/// MAX_DETAIL_FETCH / SAMPLE_FIRST_PAGE_ONLY pour tester avant la sync complète.
#[tauri::command]
pub async fn sync_ship_data(app: AppHandle) -> Result<WikiSyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    // ── 1. Liste des stubs (uuid + name) ──
    let mut stubs: Vec<(String, String)> = Vec::new();
    let mut page = 1u32;
    let mut last_page = 1u32;
    loop {
        let url = format!("{WIKI_BASE}/vehicles?limit=100&page={page}");
        // Best-effort : une page de liste qui échoue (après retries) est ignorée.
        let json = match fetch_with_retry(&client, &url).await {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[wiki_sync] page liste vaisseaux {page} échouée (ignorée) : {e}");
                if SAMPLE_FIRST_PAGE_ONLY || page >= last_page {
                    break;
                }
                page += 1;
                tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
                continue;
            }
        };
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for item in arr {
                if let Some(uuid) = vstr(item, "uuid") {
                    let name = vstr(item, "name").unwrap_or_default();
                    stubs.push((uuid, name));
                }
            }
        }
        if SAMPLE_FIRST_PAGE_ONLY {
            break;
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // Plafond échantillon : on priorise les vaisseaux de la flotte (tri stable : possédés
    // en tête) AVANT de tronquer, pour garantir un vaisseau testable dans le Loadout Planner.
    if let Some(max) = MAX_DETAIL_FETCH {
        let fleet = fleet_ship_names(&app).await.unwrap_or_default();
        if !fleet.is_empty() {
            stubs.sort_by_key(|(_, name)| {
                if fleet.contains(&name.trim().to_lowercase()) {
                    0
                } else {
                    1
                }
            });
        }
        stubs.truncate(max);
    }
    let uuids: Vec<String> = stubs.into_iter().map(|(uuid, _)| uuid).collect();

    // ── 2. Détail par vaisseau (+ hardpoints, Phase 2b) + upsert ──
    // ?include=hardpoints : ZÉRO requête supplémentaire, on parse l'arbre en plus.
    let mut synced = 0i64;
    let mut hardpoints_synced = 0i64;
    let mut errors = 0i64;
    let mut sampled: Vec<SampledShip> = Vec::new();
    let total = uuids.len();
    for (idx, uuid) in uuids.iter().enumerate() {
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "vehicles", "current": idx + 1, "total": total }),
        );
        let url = format!("{WIKI_BASE}/vehicles/{uuid}?include=hardpoints");
        match fetch_with_retry(&client, &url).await {
            Ok(json) => {
                let v = json.get("data").unwrap_or(&json).clone();
                match upsert_vehicle(&app, &v).await {
                    Ok(Some(ship_data_id)) => {
                        synced += 1;
                        // Hardpoints : best-effort, n'invalide pas le vaisseau si échec.
                        let hp_count = match v.get("hardpoints") {
                            Some(hps) => match sync_hardpoints_for_ship(&app, ship_data_id, hps).await {
                                Ok(n) => n,
                                Err(e) => {
                                    eprintln!("[wiki_sync] hardpoints échoués (ignoré) : {e}");
                                    0
                                }
                            },
                            None => 0,
                        };
                        hardpoints_synced += hp_count;
                        sampled.push(SampledShip {
                            name: vstr(&v, "name").unwrap_or_default(),
                            hardpoints: hp_count,
                        });
                    }
                    Ok(None) => {}
                    Err(e) => {
                        errors += 1;
                        if errors <= 5 {
                            eprintln!(
                                "[wiki_sync] vaisseau échoué (item {:?}) : {e}",
                                vstr(&v, "name").unwrap_or_default(),
                            );
                        }
                    }
                }
            }
            Err(e) => {
                errors += 1;
                if errors <= 5 {
                    eprintln!("[wiki_sync] détail vaisseau {uuid} échoué (réseau) : {e}");
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // Radar tactique : recompute sur tout le catalogue (best-effort, non bloquant).
    if let Err(e) = recompute_radar_scores(&app).await {
        eprintln!("[wiki_sync] recompute radar échoué (ignoré) : {e}");
    }

    // baseDps : recompute en fin de sync (best-effort). Correct dès que les composants
    // sont aussi présents ; sinon recalculé à la fin de la sync composants.
    if let Err(e) = recompute_base_dps(&app).await {
        eprintln!("[wiki_sync] recompute baseDps échoué (ignoré) : {e}");
    }

    Ok(WikiSyncResult {
        vehiclesSynced: synced,
        hardpointsSynced: hardpoints_synced,
        errors,
        sample: MAX_DETAIL_FETCH.is_some() || SAMPLE_FIRST_PAGE_ONLY,
        sampledShips: sampled,
    })
}

/// Synchronise les composants SC Wiki (/items) → table Component (+ MissileStats).
/// PHASE 2a (échantillon) : plafonné par COMPONENTS_MAX_PAGES. Best-effort.
#[tauri::command]
pub async fn sync_components(app: AppHandle) -> Result<ComponentSyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut synced = 0i64;
    let mut errors = 0i64;
    let mut page = 1u32;
    let mut last_page = 1u32;
    loop {
        let url = format!("{WIKI_BASE}/items?limit=100&page={page}");
        // Best-effort : une page d'items qui échoue (après retries) est ignorée.
        let json = match fetch_with_retry(&client, &url).await {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[wiki_sync] page composants {page} échouée (ignorée) : {e}");
                errors += 1;
                if COMPONENTS_MAX_PAGES.is_some_and(|max| page >= max) || page >= last_page {
                    break;
                }
                page += 1;
                tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
                continue;
            }
        };
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        let total_pages = COMPONENTS_MAX_PAGES.map_or(last_page, |max| max.min(last_page));
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "components", "current": page, "total": total_pages }),
        );
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for item in arr {
                match upsert_component(&app, item).await {
                    Ok(true) => synced += 1,
                    Ok(false) => {}
                    Err(e) => {
                        errors += 1;
                        // Surface le VRAI message (plafonné) : ne plus jamais avaler
                        // une erreur systématique d'insertion en silence.
                        if errors <= 5 {
                            eprintln!(
                                "[wiki_sync] composant échoué (item {:?}) : {e}",
                                item.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
                            );
                        }
                    }
                }
            }
        }
        if COMPONENTS_MAX_PAGES.is_some_and(|max| page >= max) {
            break;
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // baseDps : recompute en fin de sync composants (best-effort). C'est ici que le calcul
    // devient correct si les composants manquaient lors de la sync vaisseaux+hardpoints.
    if let Err(e) = recompute_base_dps(&app).await {
        eprintln!("[wiki_sync] recompute baseDps échoué (ignoré) : {e}");
    }

    Ok(ComponentSyncResult {
        componentsSynced: synced,
        errors,
        sample: COMPONENTS_MAX_PAGES.is_some(),
    })
}

/// Synchronise le catalogue de missions SC Wiki (/missions) → table Mission (+ blueprints).
/// 100 % API (pas de datamining). Best-effort : une page en échec est loggée et ignorée.
#[tauri::command]
pub async fn sync_missions(app: AppHandle) -> Result<MissionSyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut synced = 0i64;
    let mut errors = 0i64;
    let mut page = 1u32;
    let mut last_page = 1u32;
    let mut game_version: Option<String> = None;

    loop {
        let url = format!("{WIKI_BASE}/missions?limit=100&page={page}");
        // Best-effort : une page qui échoue (après retries) est ignorée.
        let json = match fetch_with_retry(&client, &url).await {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[wiki_sync] page missions {page} échouée (ignorée) : {e}");
                errors += 1;
                if page >= last_page {
                    break;
                }
                page += 1;
                tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
                continue;
            }
        };
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "missions", "current": page, "total": last_page }),
        );
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for item in arr {
                if game_version.is_none() {
                    game_version = vstr(item, "game_version");
                }
                match upsert_mission(&app, item).await {
                    Ok(true) => synced += 1,
                    Ok(false) => {}
                    Err(e) => {
                        errors += 1;
                        if errors <= 5 {
                            eprintln!(
                                "[wiki_sync] mission échouée (item {:?}) : {e}",
                                item.get("title").and_then(|v| v.as_str()).unwrap_or("?"),
                            );
                        }
                    }
                }
            }
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // AppMeta : horodatage + version de jeu détectée (best-effort).
    {
        let instances = app.state::<DbInstances>();
        let lock = instances.0.read().await;
        if let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) {
            let _ = sqlx::query(
                "INSERT INTO AppMeta (key, value) VALUES ('missions.lastSyncedAt', datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = datetime('now')",
            )
            .execute(pool)
            .await;
            if let Some(gv) = &game_version {
                let _ = sqlx::query(
                    "INSERT INTO AppMeta (key, value) VALUES ('missions.lastSyncedGameVersion', ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(gv)
                .execute(pool)
                .await;
            }
        }
    }

    Ok(MissionSyncResult {
        missionsSynced: synced,
        errors,
    })
}

/// Synchronise le catalogue de blueprints SC Wiki (/blueprints) → CraftingBlueprint
/// (+ ingrédients). Phase 1 = LISTE (gros volume, ingrédients « à plat » de repli). Phase 2 =
/// DÉTAIL pour TOUS les blueprints : emplacements réels (aspects → slots/ingrédients +
/// données simulateur) ET liens missions. 100 % API, ~1 appel détail/blueprint (coût assumé).
/// Best-effort : une page/recette en échec est loggée et ignorée (repli sur le flat).
#[tauri::command]
pub async fn sync_blueprints(app: AppHandle) -> Result<BlueprintSyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut synced = 0i64;
    let mut errors = 0i64;
    let mut page = 1u32;
    let mut last_page = 1u32;
    let mut game_version: Option<String> = None;
    // Blueprints à enrichir en phase 2 (uniquement ceux qui ont des missions de déblocage).
    let mut need_detail: Vec<String> = Vec::new();

    // ── Phase 1 : LISTE (blueprints + ingrédients) ──
    loop {
        let url = format!("{WIKI_BASE}/blueprints?limit=100&page={page}");
        let json = match fetch_with_retry(&client, &url).await {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[wiki_sync] page blueprints {page} échouée (ignorée) : {e}");
                errors += 1;
                if page >= last_page {
                    break;
                }
                page += 1;
                tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
                continue;
            }
        };
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "blueprints", "current": page, "total": last_page }),
        );
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for item in arr {
                if game_version.is_none() {
                    game_version = vstr(item, "game_version");
                }
                match upsert_blueprint(&app, item).await {
                    Ok(true) => {
                        synced += 1;
                        // Phase 2 = DÉTAIL pour TOUS les blueprints (slots/aspects + missions).
                        if let Some(uuid) = vstr(item, "uuid") {
                            need_detail.push(uuid);
                        }
                    }
                    Ok(false) => {}
                    Err(e) => {
                        errors += 1;
                        if errors <= 5 {
                            eprintln!(
                                "[wiki_sync] blueprint échoué (item {:?}) : {e}",
                                item.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
                            );
                        }
                    }
                }
            }
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // ── Phase 2 : DÉTAIL ciblé (liens missions), plafonné ──
    if let Some(max) = MAX_BLUEPRINT_DETAIL_FETCH {
        need_detail.truncate(max);
    }
    let to_fetch = need_detail.len();
    let mut links_created = 0i64;
    let mut links_skipped = 0i64;
    let mut blueprints_with_slots = 0i64;
    for (i, bp_uuid) in need_detail.iter().enumerate() {
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "blueprint-details", "current": i + 1, "total": to_fetch }),
        );
        let url = format!("{WIKI_BASE}/blueprints/{bp_uuid}");
        let detail = match fetch_with_retry(&client, &url).await {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[wiki_sync] détail blueprint {bp_uuid} échoué (ignoré) : {e}");
                errors += 1;
                tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
                continue;
            }
        };
        // Le détail enveloppe la recette dans "data".
        let body = detail.get("data").unwrap_or(&detail);
        // Liens missions (inchangé) + emplacements (aspects → slots/ingrédients réels).
        match link_blueprint_missions(&app, bp_uuid, body).await {
            Ok((c, s)) => {
                links_created += c;
                links_skipped += s;
            }
            Err(e) => {
                errors += 1;
                if errors <= 5 {
                    eprintln!("[wiki_sync] liens missions blueprint {bp_uuid} échoués : {e}");
                }
            }
        }
        match upsert_blueprint_aspects(&app, bp_uuid, body).await {
            Ok(n) if n > 0 => blueprints_with_slots += 1,
            Ok(_) => {} // pas d'aspects → ingrédients à plat conservés (repli)
            Err(e) => {
                errors += 1;
                if errors <= 5 {
                    eprintln!("[wiki_sync] aspects blueprint {bp_uuid} échoués : {e}");
                }
            }
        }
        // Métadonnées objet (grade/size/manufacturer/itemType/subType + webUrl) → en-tête R2,
        // sans appel live à l'ouverture. UN appel /items en plus par blueprint.
        if let Err(e) = upsert_blueprint_meta(&app, &client, bp_uuid, body).await {
            errors += 1;
            if errors <= 5 {
                eprintln!("[wiki_sync] métadonnées blueprint {bp_uuid} échouées : {e}");
            }
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // ── AppMeta : horodatage + version de jeu détectée (best-effort). ──
    {
        let instances = app.state::<DbInstances>();
        let lock = instances.0.read().await;
        if let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) {
            let _ = sqlx::query(
                "INSERT INTO AppMeta (key, value) VALUES ('blueprints.lastSyncedAt', datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = datetime('now')",
            )
            .execute(pool)
            .await;
            if let Some(gv) = &game_version {
                let _ = sqlx::query(
                    "INSERT INTO AppMeta (key, value) VALUES ('blueprints.lastSyncedGameVersion', ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(gv)
                .execute(pool)
                .await;
            }
        }
    }

    // Enrichissement des stats de craft depuis les dumps datamining (best-effort).
    // Dump absent → ignoré sans erreur. Renseigne CraftingBlueprint.producedItemStatsJson.
    match crate::commands::datamining::enrich_blueprint_stats(app.clone()).await {
        Ok(s) => eprintln!(
            "[wiki_sync] stats de craft enrichies : {} écrits / {} avec stats (SureStop={:?})",
            s.stats_written, s.blueprints_with_stats, s.sample_sure_stop_shield_hp
        ),
        Err(e) => eprintln!("[wiki_sync] enrichissement stats ignoré : {e}"),
    }

    // Localisations de minage (ResourceMiningLocation) depuis les dumps (best-effort).
    // Stats de craft + où-miner DÉRIVENT des blueprints → restent rattachés ici.
    // La carte galactique (starmap) est indépendante → bouton dédié dans Settings.
    match crate::commands::datamining::sync_mining_locations(app.clone()).await {
        Ok(m) => eprintln!(
            "[wiki_sync] où miner : {} localisations / {} minerais / {} corps",
            m.rows_written, m.distinct_resources, m.distinct_bodies
        ),
        Err(e) => eprintln!("[wiki_sync] localisations de minage ignorées : {e}"),
    }

    Ok(BlueprintSyncResult {
        blueprintsSynced: synced,
        blueprintsWithSlots: blueprints_with_slots,
        missionLinksCreated: links_created,
        missionLinksSkipped: links_skipped,
        errors,
    })
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
mod vehicles;
pub(crate) use vehicles::*;
mod components;
pub(crate) use components::*;
mod missions;
pub(crate) use missions::*;
mod blueprints;
pub(crate) use blueprints::*;