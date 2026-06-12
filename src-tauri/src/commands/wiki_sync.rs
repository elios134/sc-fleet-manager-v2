use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";

// Robustesse réseau (réplique V1 scWikiSync.ts).
const RATE_LIMIT_DELAY_MS: u64 = 100;
const REQUEST_TIMEOUT_SECS: u64 = 15;
const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY_MS: u64 = 500;

// ── Plafonds (SYNC COMPLÈTE) ──
// Pour repasser en échantillon de test : MAX_DETAIL_FETCH = 10.
// Nombre maximum d'appels détail (0 = illimité). Limite vaisseaux + hardpoints.
// En mode échantillon, les vaisseaux de la flotte sont priorisés (cf. sync_ship_data)
// pour garantir que le test Loadout Planner trouve des slots sur un vaisseau possédé.
const MAX_DETAIL_FETCH: usize = 0;
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

/* ──────────────────────────────  Upsert ShipData  ─────────────────────────── */

/// Mappe un vaisseau SC Wiki (objet `data` du détail) → ShipData et upsert par `wikiId`.
/// Réplique exacte du mapping V1 (mapVehicleToShipData). Renvoie Some(id ShipData) si
/// écrit, None si ignoré (pas de nom). L'id sert à rattacher les hardpoints (Phase 2b).
async fn upsert_vehicle(app: &AppHandle, v: &Value) -> Result<Option<i64>, String> {
    let Some(name) = vstr(v, "name") else {
        return Ok(None);
    };

    let wiki_id = vstr(v, "uuid");
    let rsi_ship_id = vi64(v, "id");
    let wiki_version = vstr(v, "version");
    let manufacturer = v
        .get("manufacturer")
        .and_then(|m| vstr(m, "name"))
        .unwrap_or_default();
    let role = vstr(v, "career").unwrap_or_default(); // career → role
    let classification = vstr(v, "role").unwrap_or_default(); // role → classification
    let focus = extract_focus(v);
    let size = v.get("sizes").and_then(|s| vstr(s, "class"));
    let length = v.get("sizes").and_then(|s| vf64(s, "length"));
    let beam = v.get("sizes").and_then(|s| vf64(s, "beam"));
    let height = v.get("sizes").and_then(|s| vf64(s, "height"));
    let max_speed = v.get("speed").and_then(|s| vf64(s, "max"));
    let scm_speed = v.get("speed").and_then(|s| vf64(s, "scm"));
    let hull_hp = vf64(v, "health");
    let shield_hp = v.get("shield").and_then(|s| vf64(s, "hp"));
    let cargo_scu = vf64(v, "cargo_capacity").map(|x| x as i64);
    let crew_min = v.get("crew").and_then(|c| vi64(c, "min"));
    let crew_max = v.get("crew").and_then(|c| vi64(c, "max"));
    let mass = vf64(v, "mass_hull");
    let msrp_usd = vf64(v, "msrp").map(|x| x as i64);
    let image_url = v
        .get("images")
        .and_then(|i| i.as_array())
        .and_then(|a| a.first())
        .and_then(|img| vstr(img, "original_url"));
    let em_signature = v.get("emission").and_then(|e| vf64(e, "em_idle"));
    let ir_signature = v.get("emission").and_then(|e| vf64(e, "ir"));
    let cross_section = vf64(v, "cross_section_max");
    let class_name_cig = vstr(v, "class_name");
    let pitch_rate = v.get("agility").and_then(|a| vf64(a, "pitch"));
    let yaw_rate = v.get("agility").and_then(|a| vf64(a, "yaw"));
    let roll_rate = v.get("agility").and_then(|a| vf64(a, "roll"));

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query(
        "INSERT INTO ShipData
           (wikiId, rsiShipId, wikiVersion, name, manufacturer, role, classification, focus,
            size, length, beam, height, maxSpeed, scmSpeed, hullHp, shieldHp, cargoScu,
            crewMin, crewMax, mass, msrpUsd, imageUrl, emSignature, irSignature, crossSection,
            classNameCig, pitchRate, yawRate, rollRate, source, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'wiki', datetime('now'))
         ON CONFLICT(wikiId) DO UPDATE SET
           rsiShipId=excluded.rsiShipId, wikiVersion=excluded.wikiVersion, name=excluded.name,
           manufacturer=excluded.manufacturer, role=excluded.role,
           classification=excluded.classification, focus=excluded.focus, size=excluded.size,
           length=excluded.length, beam=excluded.beam, height=excluded.height,
           maxSpeed=excluded.maxSpeed, scmSpeed=excluded.scmSpeed, hullHp=excluded.hullHp,
           shieldHp=excluded.shieldHp, cargoScu=excluded.cargoScu, crewMin=excluded.crewMin,
           crewMax=excluded.crewMax, mass=excluded.mass, msrpUsd=excluded.msrpUsd,
           imageUrl=excluded.imageUrl, emSignature=excluded.emSignature,
           irSignature=excluded.irSignature, crossSection=excluded.crossSection,
           classNameCig=excluded.classNameCig, pitchRate=excluded.pitchRate,
           yawRate=excluded.yawRate, rollRate=excluded.rollRate, lastSyncedAt=datetime('now')
         RETURNING id",
    )
    .bind(wiki_id)
    .bind(rsi_ship_id)
    .bind(wiki_version)
    .bind(&name)
    .bind(&manufacturer)
    .bind(&role)
    .bind(&classification)
    .bind(&focus)
    .bind(size)
    .bind(length)
    .bind(beam)
    .bind(height)
    .bind(max_speed)
    .bind(scm_speed)
    .bind(hull_hp)
    .bind(shield_hp)
    .bind(cargo_scu)
    .bind(crew_min)
    .bind(crew_max)
    .bind(mass)
    .bind(msrp_usd)
    .bind(image_url)
    .bind(em_signature)
    .bind(ir_signature)
    .bind(cross_section)
    .bind(class_name_cig)
    .bind(pitch_rate)
    .bind(yaw_rate)
    .bind(roll_rate)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let ship_data_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;

    Ok(Some(ship_data_id))
}

/* ════════════════════  Phase 2b — Hardpoints (slots)  ═════════════════════ */

/// Type de hardpoint SC Wiki → type de slot canonique (réplique HP_TYPE_MAP V1).
fn hp_type_map(t: &str) -> Option<&'static str> {
    match t {
        "WeaponGun" | "Turret" | "GunTurret" | "BallTurret" | "MiningLaser" => Some("WEAPON"),
        "Shield" => Some("SHIELD"),
        "Cooler" => Some("COOLER"),
        "PowerPlant" => Some("POWER_PLANT"),
        "QuantumDrive" => Some("QUANTUM_DRIVE"),
        "MissileLauncher" | "Missile" => Some("MISSILE"),
        _ => None,
    }
}

/// portName → displayName : retire le préfixe "hardpoint_", remplace "_" par " ", trim.
fn clean_display_name(name: &str) -> String {
    let stripped = if name.to_lowercase().starts_with("hardpoint_") {
        &name[10..]
    } else {
        name
    };
    stripped.replace('_', " ").trim().to_string()
}

/// Réplique syncHardpointsForShip + createHardpointRecursive V1.
/// CLEAR-THEN-RECREATE par vaisseau (supprime les ShipHardpoint source='wiki' puis recrée
/// à partir de l'arbre `hardpoints`). Un nœud non mappable est sauté MAIS ses enfants sont
/// rattachés au grand-parent (parentId conservé). Renvoie le nombre de slots créés.
async fn sync_hardpoints_for_ship(
    app: &AppHandle,
    ship_id: i64,
    hardpoints: &Value,
) -> Result<i64, String> {
    let arr = match hardpoints.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => return Ok(0),
    };

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Clear : on ne supprime que les hardpoints d'origine 'wiki' de ce vaisseau.
    sqlx::query("DELETE FROM ShipHardpoint WHERE shipId = ? AND source = 'wiki'")
        .bind(ship_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Parcours itératif (évite la récursion async). Pile de (nœud, parentId hérité).
    let mut stack: Vec<(&Value, Option<i64>)> = arr.iter().rev().map(|hp| (hp, None)).collect();
    let mut count = 0i64;

    while let Some((hp, parent_id)) = stack.pop() {
        let raw_type = hp.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let raw_sub = hp.get("sub_type").and_then(|x| x.as_str()).unwrap_or("");
        let mapped = hp_type_map(raw_type).or_else(|| hp_type_map(raw_sub));
        let min_size = vi64(hp, "min_size");
        let max_size = vi64(hp, "max_size");
        let children = hp.get("children").and_then(|c| c.as_array());

        match (mapped, min_size, max_size) {
            (Some(slot_type), Some(mn), Some(mx)) => {
                let name = vstr(hp, "name").unwrap_or_default();
                let display = clean_display_name(&name);
                let sub_type = vstr(hp, "sub_type");
                let default_cn = hp.get("item").and_then(|i| vstr(i, "class_name"));

                let row = sqlx::query(
                    "INSERT INTO ShipHardpoint
                       (shipId, portName, displayName, type, subType, minSize, maxSize,
                        defaultComponentClassName, posX, posY, posZ, normalizedX, normalizedY,
                        source, parentId)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'wiki', ?)
                     RETURNING id",
                )
                .bind(ship_id)
                .bind(&name)
                .bind(&display)
                .bind(slot_type)
                .bind(sub_type)
                .bind(mn)
                .bind(mx)
                .bind(default_cn)
                .bind(parent_id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
                let new_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
                count += 1;

                if let Some(kids) = children {
                    for kid in kids.iter().rev() {
                        stack.push((kid, Some(new_id)));
                    }
                }
            }
            _ => {
                // Non mappable : ligne sautée, enfants rattachés au grand-parent.
                if let Some(kids) = children {
                    for kid in kids.iter().rev() {
                        stack.push((kid, parent_id));
                    }
                }
            }
        }
    }

    Ok(count)
}

/* ──────────────────────────────  Radar tactique  ─────────────────────────── */

/// Normalisation relative 0-100 (réplique V1 normalizeAxis) : 0 si l'axe est plat.
fn normalize_axis(v: f64, min: f64, max: f64) -> f64 {
    if max == min {
        0.0
    } else {
        (((v - min) / (max - min)) * 100.0).round()
    }
}

/// Valeurs brutes d'un vaisseau (mapping détourné V1 assumé).
struct RawScores {
    id: i64,
    speed: f64,   // maxSpeed            → radarSpeed
    agility: f64, // scmSpeed/√(mass/1000) → radarAgility
    shield: f64,  // shieldHp            → radarDefense
    cargo: f64,   // cargoScu            → radarFirepower (repurposé)
    crew: f64,    // crewMax             → radarRange    (repurposé)
    hull: f64,    // hullHp              → radarUtility  (repurposé)
}

/// Recalcule les 6 colonnes radar de ShipData (réplique V1 recomputeRadarScores).
/// Normalisation RELATIVE : min/max sur l'ensemble du catalogue → à relancer après
/// chaque sync. Best-effort : l'appelant ignore l'erreur (vaisseaux déjà importés).
async fn recompute_radar_scores(app: &AppHandle) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let rows = sqlx::query(
        "SELECT id, maxSpeed, scmSpeed, mass, shieldHp, hullHp, cargoScu, crewMax FROM ShipData",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Ok(());
    }

    // Valeurs brutes (null → 0 comme V1).
    let mut scored: Vec<RawScores> = Vec::with_capacity(rows.len());
    for r in &rows {
        let id: i64 = r.try_get("id").map_err(|e| e.to_string())?;
        let f = |col: &str| r.try_get::<Option<f64>, _>(col).ok().flatten().unwrap_or(0.0);
        let i = |col: &str| {
            r.try_get::<Option<i64>, _>(col)
                .ok()
                .flatten()
                .map(|v| v as f64)
                .unwrap_or(0.0)
        };
        let scm = f("scmSpeed");
        let mass = f("mass");
        scored.push(RawScores {
            id,
            speed: f("maxSpeed"),
            agility: if mass > 0.0 { scm / (mass / 1000.0).sqrt() } else { 0.0 },
            shield: f("shieldHp"),
            cargo: i("cargoScu"),
            crew: i("crewMax"),
            hull: f("hullHp"),
        });
    }

    // min/max par axe sur l'ensemble (ordre : speed, agility, shield, cargo, crew, hull).
    let mut bounds = [(f64::INFINITY, f64::NEG_INFINITY); 6];
    for s in &scored {
        let axes = [s.speed, s.agility, s.shield, s.cargo, s.crew, s.hull];
        for (i, &val) in axes.iter().enumerate() {
            if val < bounds[i].0 {
                bounds[i].0 = val;
            }
            if val > bounds[i].1 {
                bounds[i].1 = val;
            }
        }
    }

    // UPDATE de chaque ligne dans une seule transaction.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for s in &scored {
        let radar_speed = normalize_axis(s.speed, bounds[0].0, bounds[0].1);
        let radar_agility = normalize_axis(s.agility, bounds[1].0, bounds[1].1);
        let radar_defense = normalize_axis(s.shield, bounds[2].0, bounds[2].1);
        let radar_firepower = normalize_axis(s.cargo, bounds[3].0, bounds[3].1);
        let radar_range = normalize_axis(s.crew, bounds[4].0, bounds[4].1);
        let radar_utility = normalize_axis(s.hull, bounds[5].0, bounds[5].1);
        sqlx::query(
            "UPDATE ShipData SET radarSpeed=?, radarAgility=?, radarDefense=?,
                                 radarFirepower=?, radarRange=?, radarUtility=? WHERE id=?",
        )
        .bind(radar_speed)
        .bind(radar_agility)
        .bind(radar_defense)
        .bind(radar_firepower)
        .bind(radar_range)
        .bind(radar_utility)
        .bind(s.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

/* ──────────────────────────────  Commande exposée  ────────────────────────── */

/// Noms (minuscules) des vaisseaux de la flotte (tous comptes confondus).
/// Sert à prioriser l'échantillon Phase 2b sur les vaisseaux réellement possédés.
async fn fleet_ship_names(app: &AppHandle) -> Result<std::collections::HashSet<String>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let rows = sqlx::query("SELECT DISTINCT name FROM Ship")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .map(|s| s.trim().to_lowercase())
        .collect())
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct SampledShip {
    name: String,
    hardpoints: i64,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct WikiSyncResult {
    vehiclesSynced: i64,
    hardpointsSynced: i64,
    errors: i64,
    sample: bool,
    sampledShips: Vec<SampledShip>,
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
    if MAX_DETAIL_FETCH > 0 {
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
        if stubs.len() > MAX_DETAIL_FETCH {
            stubs.truncate(MAX_DETAIL_FETCH);
        }
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
                    Err(_) => errors += 1,
                }
            }
            Err(_) => errors += 1,
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    // Radar tactique : recompute sur tout le catalogue (best-effort, non bloquant).
    if let Err(e) = recompute_radar_scores(&app).await {
        eprintln!("[wiki_sync] recompute radar échoué (ignoré) : {e}");
    }

    Ok(WikiSyncResult {
        vehiclesSynced: synced,
        hardpointsSynced: hardpoints_synced,
        errors,
        sample: MAX_DETAIL_FETCH > 0 || SAMPLE_FIRST_PAGE_ONLY,
        sampledShips: sampled,
    })
}

/* ════════════════════════  Phase 2a — Composants (/items)  ════════════════════ */

// Plafond ÉCHANTILLON (test avant sync complète). 0 = illimité (toutes les pages).
const COMPONENTS_MAX_PAGES: u32 = 0;

/// Valeur flottante via un chemin imbriqué (ex. ["vehicle_weapon","damage","burst"]).
fn nf64(v: &Value, path: &[&str]) -> Option<f64> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_f64()
}

/// Type d'item SC Wiki → slotType canonique (réplique ITEM_TYPE_TO_SLOT V1).
fn item_type_to_slot(t: &str) -> Option<&'static str> {
    match t {
        "WeaponGun" | "WeaponBeam" | "WeaponPlasma" | "WeaponLaser" | "MiningLaser" | "Turret"
        | "WeaponDefensive" => Some("WEAPON"),
        "Shield" => Some("SHIELD"),
        "Cooler" => Some("COOLER"),
        "PowerPlant" => Some("POWER_PLANT"),
        "QuantumDrive" => Some("QUANTUM_DRIVE"),
        "Missile" | "MissileLauncher" => Some("MISSILE"),
        _ => None,
    }
}

/// powerDraw : resource_network.states[].deltas[] où resource == "power" (réplique V1).
fn extract_power_draw(item: &Value) -> Option<f64> {
    let states = item
        .get("resource_network")
        .and_then(|r| r.get("states"))
        .and_then(|s| s.as_array())?;
    for state in states {
        if let Some(deltas) = state.get("deltas").and_then(|d| d.as_array()) {
            for delta in deltas {
                let res = delta.get("resource").and_then(|r| r.as_str()).map(|s| s.to_lowercase());
                if res.as_deref() == Some("power") {
                    if let Some(rate) = delta.get("rate").and_then(|r| r.as_f64()) {
                        return Some(rate);
                    }
                }
            }
        }
    }
    None
}

/// powerDrawMin : usage.power.min sinon resource_network rate × minimum_fraction (V1).
fn extract_power_draw_min(item: &Value) -> Option<f64> {
    if let Some(min) = nf64(item, &["usage", "power", "min"]) {
        return Some(min);
    }
    let states = item
        .get("resource_network")
        .and_then(|r| r.get("states"))
        .and_then(|s| s.as_array())?;
    for state in states {
        if let Some(deltas) = state.get("deltas").and_then(|d| d.as_array()) {
            for delta in deltas {
                let res = delta.get("resource").and_then(|r| r.as_str()).map(|s| s.to_lowercase());
                let rate = delta.get("rate").and_then(|r| r.as_f64());
                let frac = delta.get("minimum_fraction").and_then(|r| r.as_f64());
                if res.as_deref() == Some("power") {
                    if let (Some(rate), Some(frac)) = (rate, frac) {
                        return Some(rate * frac);
                    }
                }
            }
        }
    }
    None
}

/// grade : string ou number → string (la colonne grade est TEXT).
fn coerce_grade(item: &Value) -> Option<String> {
    match item.get("grade") {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// required_tags → JSON string (toujours un tableau, "[]" si absent).
fn required_tags_json(item: &Value) -> String {
    match item.get("required_tags") {
        Some(v) if v.is_array() => serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()),
        _ => "[]".to_string(),
    }
}

/// Mappe un item SC Wiki → Component (+ MissileStats) et upsert par wikiId.
/// Réplique exacte de mapItemToComponent V1. Renvoie true si écrit, false si ignoré
/// (type hors mapping, ou size absent/0).
async fn upsert_component(app: &AppHandle, item: &Value) -> Result<bool, String> {
    let Some(type_raw) = vstr(item, "type") else {
        return Ok(false);
    };
    let Some(slot) = item_type_to_slot(&type_raw) else {
        return Ok(false); // cosmétique, siège, peinture…
    };
    let Some(size) = vi64(item, "size").filter(|s| *s != 0) else {
        return Ok(false); // composant sans dimension
    };

    let name = vstr(item, "name").unwrap_or_default();
    let wiki_id = vstr(item, "uuid");
    let class_name = vstr(item, "class_name");
    let manufacturer = item.get("manufacturer").and_then(|m| vstr(m, "name"));
    let grade = coerce_grade(item);
    let class = vstr(item, "class");
    let sub_type = vstr(item, "sub_type");
    let required_tags = required_tags_json(item);

    let durability_health = nf64(item, &["durability", "health"]);
    let em_max = nf64(item, &["emission", "em_max"]);
    let ir_max = nf64(item, &["emission", "ir"]);
    let power_draw_min = extract_power_draw_min(item);
    let mut power_draw = extract_power_draw(item);

    let mut dps = None;
    let mut shield_hp = None;
    let mut heat_gen = None;
    let mut range = None;
    let mut alpha = None;
    let mut shield_regen_rate = None;
    let mut shield_delay_dmg = None;
    let mut shield_delay_down = None;
    let mut power_output = None;
    let mut w_fire = None;
    let mut w_proj = None;
    let mut w_spread = None;
    let mut w_ammo_cap = None;
    let mut w_ammo_regen = None;
    let mut w_pen = None;
    let mut w_overheat = None;
    let mut shield_regen_time = None;
    let mut qt_speed = None;
    let mut qt_spool = None;
    let mut qt_cd = None;
    let mut qt_fuel = None;
    let mut qt_eff = None;

    match slot {
        "WEAPON" => {
            dps = nf64(item, &["vehicle_weapon", "damage", "burst"]);
            alpha = nf64(item, &["vehicle_weapon", "damage", "alpha_total"]);
            range = nf64(item, &["vehicle_weapon", "range"]).or_else(|| nf64(item, &["ammunition", "range"]));
            heat_gen = nf64(item, &["vehicle_weapon", "heat", "per_shot"]);
            w_fire = nf64(item, &["vehicle_weapon", "rpm"]);
            w_proj = nf64(item, &["vehicle_weapon", "ammunition", "speed"]);
            w_spread = nf64(item, &["vehicle_weapon", "spread", "max"]);
            w_ammo_cap = nf64(item, &["vehicle_weapon", "capacitor", "max_ammo_load"]);
            w_ammo_regen = nf64(item, &["vehicle_weapon", "capacitor", "regen_per_second"]);
            w_pen = nf64(item, &["vehicle_weapon", "ammunition", "penetration", "base_distance"]);
            w_overheat = nf64(item, &["distortion", "shutdown_time"]);
        }
        "SHIELD" => {
            shield_hp = nf64(item, &["shield", "max_health"]);
            shield_regen_rate = nf64(item, &["shield", "regen_rate"]);
            shield_delay_dmg = nf64(item, &["shield", "regen_delay", "damage"]);
            shield_delay_down = nf64(item, &["shield", "regen_delay", "downed"]);
            shield_regen_time = nf64(item, &["shield", "regen_time"]);
        }
        "COOLER" => {
            heat_gen = nf64(item, &["resource_network", "generation", "coolant"])
                .or_else(|| nf64(item, &["cooler", "cooling_rate"]))
                .or_else(|| nf64(item, &["cooler", "coolant_segment_generation"]));
        }
        "POWER_PLANT" => {
            power_output = nf64(item, &["resource_network", "generation", "power"])
                .or_else(|| nf64(item, &["power_plant", "power_output"]))
                .or_else(|| nf64(item, &["power_plant", "power_segment_generation"]));
            power_draw = Some(0.0); // les générateurs produisent
        }
        "QUANTUM_DRIVE" => {
            range = nf64(item, &["quantum_drive", "jump_range"]);
            qt_speed = nf64(item, &["quantum_drive", "standard_jump", "drive_speed"]);
            qt_spool = nf64(item, &["quantum_drive", "standard_jump", "spool_up_time"]);
            qt_cd = nf64(item, &["quantum_drive", "standard_jump", "cooldown_time"]);
            qt_fuel = nf64(item, &["quantum_drive", "fuel_rate"]);
            qt_eff = nf64(item, &["quantum_drive", "fuel_efficiency"]);
        }
        _ => {} // MISSILE : stats dans MissileStats (ci-dessous)
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query(
        "INSERT INTO Component
           (wikiId, className, name, manufacturer, type, size, grade, class,
            dps, shieldHp, powerDraw, heatGen, range, alphaDamage,
            shieldRegenRate, shieldDelayDmg, shieldDelayDown, powerOutput,
            durabilityHealth, emMax, irMax, powerDrawMin,
            weaponFireRate, weaponProjectileSpeed, weaponSpreadMax, weaponAmmoCapacity,
            weaponAmmoRegen, weaponPenDistance, weaponOverheatShutdown, shieldRegenTime,
            qtDriveSpeed, qtSpoolTime, qtCooldownTime, qtFuelRate, qtEfficiency,
            scWikiType, scWikiSubType, scWikiRequiredTags, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(wikiId) DO UPDATE SET
           className=excluded.className, name=excluded.name, manufacturer=excluded.manufacturer,
           type=excluded.type, size=excluded.size, grade=excluded.grade, class=excluded.class,
           dps=excluded.dps, shieldHp=excluded.shieldHp, powerDraw=excluded.powerDraw,
           heatGen=excluded.heatGen, range=excluded.range, alphaDamage=excluded.alphaDamage,
           shieldRegenRate=excluded.shieldRegenRate, shieldDelayDmg=excluded.shieldDelayDmg,
           shieldDelayDown=excluded.shieldDelayDown, powerOutput=excluded.powerOutput,
           durabilityHealth=excluded.durabilityHealth, emMax=excluded.emMax, irMax=excluded.irMax,
           powerDrawMin=excluded.powerDrawMin, weaponFireRate=excluded.weaponFireRate,
           weaponProjectileSpeed=excluded.weaponProjectileSpeed, weaponSpreadMax=excluded.weaponSpreadMax,
           weaponAmmoCapacity=excluded.weaponAmmoCapacity, weaponAmmoRegen=excluded.weaponAmmoRegen,
           weaponPenDistance=excluded.weaponPenDistance, weaponOverheatShutdown=excluded.weaponOverheatShutdown,
           shieldRegenTime=excluded.shieldRegenTime, qtDriveSpeed=excluded.qtDriveSpeed,
           qtSpoolTime=excluded.qtSpoolTime, qtCooldownTime=excluded.qtCooldownTime,
           qtFuelRate=excluded.qtFuelRate, qtEfficiency=excluded.qtEfficiency,
           scWikiType=excluded.scWikiType, scWikiSubType=excluded.scWikiSubType,
           scWikiRequiredTags=excluded.scWikiRequiredTags, lastSyncedAt=datetime('now')
         RETURNING id",
    )
    .bind(wiki_id)
    .bind(class_name)
    .bind(&name)
    .bind(manufacturer)
    .bind(slot)
    .bind(size)
    .bind(grade)
    .bind(class)
    .bind(dps)
    .bind(shield_hp)
    .bind(power_draw)
    .bind(heat_gen)
    .bind(range)
    .bind(alpha)
    .bind(shield_regen_rate)
    .bind(shield_delay_dmg)
    .bind(shield_delay_down)
    .bind(power_output)
    .bind(durability_health)
    .bind(em_max)
    .bind(ir_max)
    .bind(power_draw_min)
    .bind(w_fire)
    .bind(w_proj)
    .bind(w_spread)
    .bind(w_ammo_cap)
    .bind(w_ammo_regen)
    .bind(w_pen)
    .bind(w_overheat)
    .bind(shield_regen_time)
    .bind(qt_speed)
    .bind(qt_spool)
    .bind(qt_cd)
    .bind(qt_fuel)
    .bind(qt_eff)
    .bind(&type_raw)
    .bind(sub_type)
    .bind(&required_tags)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let component_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;

    // MissileStats pour les missiles (réplique upsertMissileStats V1).
    if slot == "MISSILE" {
        if let Some(m) = item.get("missile") {
            sqlx::query(
                "INSERT INTO MissileStats
                   (componentId, damage, signalType, armTime, lockTime, igniteTime,
                    lockAngle, lockRangeMin, lockRangeMax, speed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(componentId) DO UPDATE SET
                   damage=excluded.damage, signalType=excluded.signalType, armTime=excluded.armTime,
                   lockTime=excluded.lockTime, igniteTime=excluded.igniteTime, lockAngle=excluded.lockAngle,
                   lockRangeMin=excluded.lockRangeMin, lockRangeMax=excluded.lockRangeMax, speed=excluded.speed",
            )
            .bind(component_id)
            .bind(nf64(m, &["damage_total"]))
            .bind(vstr(m, "signal_type"))
            .bind(nf64(m, &["delays", "arm_time"]))
            .bind(nf64(m, &["lock_time"]))
            .bind(nf64(m, &["delays", "ignite_time"]))
            .bind(nf64(m, &["lock_angle"]))
            .bind(nf64(m, &["lock_range_min"]))
            .bind(nf64(m, &["lock_range_max"]))
            .bind(nf64(m, &["speed"]))
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(true)
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct ComponentSyncResult {
    componentsSynced: i64,
    errors: i64,
    sample: bool,
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
                if (COMPONENTS_MAX_PAGES > 0 && page >= COMPONENTS_MAX_PAGES) || page >= last_page {
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
        let total_pages = if COMPONENTS_MAX_PAGES > 0 {
            COMPONENTS_MAX_PAGES.min(last_page)
        } else {
            last_page
        };
        let _ = app.emit(
            "wiki:sync-progress",
            serde_json::json!({ "phase": "components", "current": page, "total": total_pages }),
        );
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for item in arr {
                match upsert_component(&app, item).await {
                    Ok(true) => synced += 1,
                    Ok(false) => {}
                    Err(_) => errors += 1,
                }
            }
        }
        if COMPONENTS_MAX_PAGES > 0 && page >= COMPONENTS_MAX_PAGES {
            break;
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    Ok(ComponentSyncResult {
        componentsSynced: synced,
        errors,
        sample: COMPONENTS_MAX_PAGES > 0,
    })
}
