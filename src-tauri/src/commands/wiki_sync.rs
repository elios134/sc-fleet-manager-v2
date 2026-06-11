use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";

// Robustesse réseau (réplique V1 scWikiSync.ts).
const RATE_LIMIT_DELAY_MS: u64 = 100;
const REQUEST_TIMEOUT_SECS: u64 = 15;
const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY_MS: u64 = 500;

// ── Plafonds (mode échantillon désactivé : sync complète) ──
// Pour repasser en échantillon de test : MAX_DETAIL_FETCH = 10 + SAMPLE_FIRST_PAGE_ONLY = true.
/// Nombre maximum d'appels détail (0 = illimité).
const MAX_DETAIL_FETCH: usize = 0;
/// Ne récupère que la 1ʳᵉ page de la liste (au lieu de paginer jusqu'au bout).
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
/// Réplique exacte du mapping V1 (mapVehicleToShipData). Renvoie true si écrit, false
/// si ignoré (pas de nom).
async fn upsert_vehicle(app: &AppHandle, v: &Value) -> Result<bool, String> {
    let Some(name) = vstr(v, "name") else {
        return Ok(false);
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

    sqlx::query(
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
           yawRate=excluded.yawRate, rollRate=excluded.rollRate, lastSyncedAt=datetime('now')",
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
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
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

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct WikiSyncResult {
    vehiclesSynced: i64,
    errors: i64,
    sample: bool,
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

    // ── 1. Liste des stubs (uuid) ──
    let mut uuids: Vec<String> = Vec::new();
    let mut page = 1u32;
    let mut last_page = 1u32;
    loop {
        let url = format!("{WIKI_BASE}/vehicles?limit=100&page={page}");
        let json = fetch_with_retry(&client, &url).await?;
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
                    uuids.push(uuid);
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

    // Plafond échantillon sur les appels détail.
    if MAX_DETAIL_FETCH > 0 && uuids.len() > MAX_DETAIL_FETCH {
        uuids.truncate(MAX_DETAIL_FETCH);
    }

    // ── 2. Détail par vaisseau + upsert ──
    let mut synced = 0i64;
    let mut errors = 0i64;
    for uuid in &uuids {
        let url = format!("{WIKI_BASE}/vehicles/{uuid}");
        match fetch_with_retry(&client, &url).await {
            Ok(json) => {
                let v = json.get("data").unwrap_or(&json);
                match upsert_vehicle(&app, v).await {
                    Ok(true) => synced += 1,
                    Ok(false) => {}
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
        errors,
        sample: MAX_DETAIL_FETCH > 0 || SAMPLE_FIRST_PAGE_ONLY,
    })
}
