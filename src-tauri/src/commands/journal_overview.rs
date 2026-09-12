// Carnet de bord — agrégats « vue d'ensemble » (refonte page Journal).
//
// Une seule passe ordonnée sur GameLogEvent pour dériver le temps de jeu (par SESSION),
// le streak, la heatmap d'activité, les tops véhicules/lieux/systèmes par heures et les
// missions. Les dépenses par boutique viennent de TradeJournal. 100 % local, lecture seule.
//
// Modèle « par session » (décidé produit) : une session = suite d'events entre deux
// marqueurs `session` (connexion) OU séparés par un trou > SESSION_GAP. Durée = du 1er au
// dernier event de la session, plafonnée (MAX_SESSION) pour éviter l'explosion si le jeu
// reste ouvert. La durée est attribuée au véhicule/lieu/système actif en fin de session.

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const SESSION_GAP_SECS: i64 = 45 * 60; // trou > 45 min → nouvelle session (marqueur manquant)
const MAX_SESSION_SECS: i64 = 8 * 3600; // garde-fou anti-AFK (jeu laissé ouvert)

/// Epoch (s) d'un horodatage ISO `2026-06-27T16:00:00.000Z`.
fn epoch(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso).ok().map(|d| d.timestamp())
}

/// Jour UTC `YYYY-MM-DD` d'un epoch.
fn day_of(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Streak courant + record à partir de l'ensemble des jours actifs (`YYYY-MM-DD`).
/// Courant = suite consécutive se terminant aujourd'hui ou hier (sinon 0).
fn streaks(days: &HashSet<String>) -> (i64, i64) {
    if days.is_empty() {
        return (0, 0);
    }
    let mut sorted: Vec<i64> = days
        .iter()
        .filter_map(|d| {
            DateTime::parse_from_rfc3339(&format!("{d}T00:00:00Z"))
                .ok()
                .map(|x| x.timestamp() / 86400)
        })
        .collect();
    sorted.sort_unstable();
    sorted.dedup();

    let mut best = 1i64;
    let mut run = 1i64;
    for w in sorted.windows(2) {
        if w[1] - w[0] == 1 {
            run += 1;
            best = best.max(run);
        } else {
            run = 1;
        }
    }
    // Streak courant : remonte depuis la fin tant que les jours se suivent, si le dernier
    // jour actif est aujourd'hui ou hier.
    let today = Utc::now().timestamp() / 86400;
    let last = *sorted.last().unwrap();
    let mut current = 0i64;
    if today - last <= 1 {
        current = 1;
        for i in (1..sorted.len()).rev() {
            if sorted[i] - sorted[i - 1] == 1 {
                current += 1;
            } else {
                break;
            }
        }
    }
    (current, best)
}

/// Trie une map nom→secondes en `[{name, seconds, <countKey>}]`, top `cap`.
fn top_by_secs(
    secs: &HashMap<String, i64>,
    counts: &HashMap<String, i64>,
    count_key: &str,
    cap: usize,
) -> Vec<Value> {
    let mut v: Vec<(&String, &i64)> = secs.iter().collect();
    v.sort_by(|a, b| b.1.cmp(a.1));
    v.into_iter()
        .take(cap)
        .map(|(name, s)| {
            json!({ "name": name, "seconds": s, count_key: counts.get(name).copied().unwrap_or(0) })
        })
        .collect()
}

/// Agrégats « vue d'ensemble » du Carnet de bord (`days` = 30/90 ; None = tout).
#[tauri::command]
pub async fn get_journal_overview(
    days: Option<i64>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("Base de données non chargée : {DB_URL}")),
    };

    let where_period = match days {
        Some(d) if d > 0 => format!("AND createdAt >= datetime('now', '-{d} days')"),
        _ => String::new(),
    };
    let rows = sqlx::query(&format!(
        "SELECT kind, detail, occurredAt FROM GameLogEvent
         WHERE occurredAt IS NOT NULL {where_period} ORDER BY occurredAt ASC"
    ))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Buckets.
    let mut total_secs = 0i64;
    let mut sessions_count = 0i64;
    let mut day_secs: HashMap<String, i64> = HashMap::new();
    let mut active_days: HashSet<String> = HashSet::new();
    let mut veh_secs: HashMap<String, i64> = HashMap::new();
    let mut veh_sessions: HashMap<String, i64> = HashMap::new();
    let mut loc_secs: HashMap<String, i64> = HashMap::new();
    let mut loc_visits: HashMap<String, i64> = HashMap::new();
    let mut sys_secs: HashMap<String, i64> = HashMap::new();
    let (mut m_completed, mut m_abandoned, mut m_failed) = (0i64, 0i64, 0i64);

    // État de la session courante.
    let mut cur_start: Option<i64> = None;
    let mut cur_last = 0i64;
    let mut cur_vehicle: Option<String> = None;
    let mut cur_location: Option<String> = None;
    let mut cur_system: Option<String> = None;
    // Les sessions se ferment dans l'ordre chronologique → la dernière fermée est la plus
    // récente ; on écrase donc `last_session` à chaque fermeture sans garde.
    let mut last_session: Option<Value> = None;

    macro_rules! close_session {
        () => {
            if let Some(start) = cur_start {
                let dur = (cur_last - start).clamp(0, MAX_SESSION_SECS);
                if dur > 0 {
                    total_secs += dur;
                    sessions_count += 1;
                    let day = day_of(start);
                    *day_secs.entry(day.clone()).or_insert(0) += dur;
                    active_days.insert(day);
                    if let Some(v) = &cur_vehicle {
                        *veh_secs.entry(v.clone()).or_insert(0) += dur;
                        *veh_sessions.entry(v.clone()).or_insert(0) += 1;
                    }
                    if let Some(l) = &cur_location {
                        *loc_secs.entry(l.clone()).or_insert(0) += dur;
                        *loc_visits.entry(l.clone()).or_insert(0) += 1;
                    }
                    if let Some(s) = &cur_system {
                        *sys_secs.entry(s.clone()).or_insert(0) += dur;
                    }
                    last_session = Some(json!({
                        "date": DateTime::<Utc>::from_timestamp(start, 0).map(|d| d.to_rfc3339()),
                        "durationSeconds": dur,
                        "vehicle": cur_vehicle,
                        "location": cur_location,
                    }));
                }
            }
        };
    }

    for r in &rows {
        let kind = r.try_get::<String, _>("kind").unwrap_or_default();
        let ts = match r.try_get::<Option<String>, _>("occurredAt").ok().flatten().as_deref().and_then(epoch) {
            Some(t) => t,
            None => continue,
        };
        let detail: Value = r
            .try_get::<Option<String>, _>("detail")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);

        let boundary = cur_start.is_none() || kind == "session" || (ts - cur_last) > SESSION_GAP_SECS;
        if boundary {
            close_session!();
            cur_start = Some(ts);
            cur_last = ts;
            cur_vehicle = None;
            cur_location = None;
            cur_system = None;
        } else {
            cur_last = ts;
        }

        match kind.as_str() {
            "vehicle" => {
                if detail.get("event").and_then(|x| x.as_str()) != Some("destruction") {
                    if let Some(v) = detail.get("vehicle").and_then(|x| x.as_str()) {
                        cur_vehicle = Some(v.to_string());
                    }
                }
            }
            "location" => {
                if let Some(z) = detail.get("zone").and_then(|x| x.as_str()) {
                    cur_location = Some(z.to_string());
                }
            }
            "system" => {
                if let Some(s) = detail.get("system").and_then(|x| x.as_str()) {
                    cur_system = Some(s.to_string());
                }
            }
            "mission" => match detail.get("outcome").and_then(|x| x.as_str()) {
                Some("completed") => m_completed += 1,
                Some("abandoned") => m_abandoned += 1,
                Some("failed") => m_failed += 1,
                _ => {}
            },
            _ => {}
        }
    }
    close_session!();

    let (streak_current, streak_record) = streaks(&active_days);
    let heatmap: Vec<Value> = {
        let mut v: Vec<(&String, &i64)> = day_secs.iter().collect();
        v.sort_by(|a, b| a.0.cmp(b.0));
        v.into_iter().map(|(d, s)| json!({ "date": d, "seconds": s })).collect()
    };
    let fav = |m: &HashMap<String, i64>| -> Value {
        m.iter()
            .max_by_key(|(_, s)| **s)
            .map(|(n, s)| json!({ "name": n, "seconds": s }))
            .unwrap_or(Value::Null)
    };
    let systems: Vec<Value> = {
        let mut v: Vec<(&String, &i64)> = sys_secs.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        v.into_iter().take(6).map(|(n, s)| json!({ "name": n, "seconds": s })).collect()
    };

    // Blueprints débloqués (possédés par le compte actif).
    let account_id: Option<String> =
        sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .and_then(|r| r.try_get::<String, _>("value").ok());
    let blueprints_unlocked: i64 =
        sqlx::query("SELECT COUNT(*) AS n FROM UserCraftingBlueprintOwned WHERE accountId IS ?")
            .bind(&account_id)
            .fetch_one(pool)
            .await
            .ok()
            .and_then(|r| r.try_get::<i64, _>("n").ok())
            .unwrap_or(0);

    // Dépenses par boutique (achats) + total.
    let shop_rows = sqlx::query(&format!(
        "SELECT COALESCE(location, '—') AS shop, SUM(totalPrice) AS spent, COUNT(*) AS n
         FROM TradeJournal
         WHERE action = 'buy' AND totalPrice IS NOT NULL
           AND (accountId IS ? OR accountId IS NULL) {where_period}
         GROUP BY shop ORDER BY spent DESC LIMIT 6"
    ))
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let spending_by_shop: Vec<Value> = shop_rows
        .iter()
        .map(|r| {
            json!({
                "shop": r.try_get::<String, _>("shop").unwrap_or_else(|_| "—".into()),
                "spent": r.try_get::<f64, _>("spent").unwrap_or(0.0),
                "count": r.try_get::<i64, _>("n").unwrap_or(0),
            })
        })
        .collect();
    let spend_total: f64 = spending_by_shop
        .iter()
        .map(|s| s["spent"].as_f64().unwrap_or(0.0))
        .sum();
    let spend_count: i64 = spending_by_shop
        .iter()
        .map(|s| s["count"].as_i64().unwrap_or(0))
        .sum();

    Ok(json!({
        "playtime": { "totalSeconds": total_secs, "sessions": sessions_count },
        "streak": { "current": streak_current, "record": streak_record },
        "lastSession": last_session,
        "heatmap": heatmap,
        "missions": { "completed": m_completed, "abandoned": m_abandoned, "failed": m_failed },
        "blueprintsUnlocked": blueprints_unlocked,
        "favoriteVehicle": fav(&veh_secs),
        "favoriteSystem": fav(&sys_secs),
        "topVehicles": top_by_secs(&veh_secs, &veh_sessions, "sessions", 5),
        "topLocations": top_by_secs(&loc_secs, &loc_visits, "visits", 5),
        "systems": systems,
        "spendingByShop": spending_by_shop,
        "spendingTotal": spend_total,
        "spendingCount": spend_count,
    }))
}
