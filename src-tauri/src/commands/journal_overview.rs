// Résumé du Game.log pour la carte « Carnet » de l'Accueil : dernière session, missions terminées,
// plans débloqués et dépenses. 100 % local, lecture seule.
//
// Une session = suite d'événements entre deux marqueurs `session` (connexion) OU séparés par un trou
// > SESSION_GAP. Durée = du 1er au dernier événement, plafonnée (MAX_SESSION) si le jeu reste ouvert.

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const SESSION_GAP_SECS: i64 = 45 * 60; // trou > 45 min → nouvelle session (marqueur manquant)
const MAX_SESSION_SECS: i64 = 8 * 3600; // garde-fou anti-AFK (jeu laissé ouvert)

/// Epoch (s) d'un horodatage ISO `2026-06-27T16:00:00.000Z`.
fn epoch(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso).ok().map(|d| d.timestamp())
}

/// Dernière session (début, durée, dernier lieu) à partir d'événements triés (epoch, kind, zone).
pub(crate) fn last_session(events: &[(i64, &str, Option<&str>)]) -> Option<(i64, i64, Option<String>)> {
    let mut start: Option<i64> = None;
    let mut last = 0i64;
    let mut location: Option<String> = None;
    for &(ts, kind, zone) in events {
        if start.is_none() || kind == "session" || ts - last > SESSION_GAP_SECS {
            start = Some(ts);
            location = None;
        }
        last = ts;
        if let Some(z) = zone {
            location = Some(z.to_string());
        }
    }
    let s = start?;
    let dur = (last - s).clamp(0, MAX_SESSION_SECS);
    (dur > 0).then_some((s, dur, location))
}

#[tauri::command]
pub async fn get_journal_overview(db_instances: tauri::State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("Base de données non chargée : {DB_URL}")),
    };

    let rows = sqlx::query("SELECT kind, detail, occurredAt FROM GameLogEvent WHERE occurredAt IS NOT NULL ORDER BY occurredAt ASC")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut events: Vec<(i64, String, Option<String>)> = Vec::new();
    let mut completed = 0i64;
    for r in &rows {
        let kind = r.try_get::<String, _>("kind").unwrap_or_default();
        let Some(ts) = r.try_get::<Option<String>, _>("occurredAt").ok().flatten().as_deref().and_then(epoch) else {
            continue;
        };
        let detail: Value = r
            .try_get::<Option<String>, _>("detail")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        if kind == "mission" && detail.get("outcome").and_then(|x| x.as_str()) == Some("completed") {
            completed += 1;
        }
        let zone = (kind == "location").then(|| detail.get("zone").and_then(|x| x.as_str()).map(str::to_string)).flatten();
        events.push((ts, kind, zone));
    }
    let refs: Vec<(i64, &str, Option<&str>)> = events.iter().map(|(t, k, z)| (*t, k.as_str(), z.as_deref())).collect();
    let last = last_session(&refs).map(|(start, dur, location)| {
        json!({
            "date": DateTime::<Utc>::from_timestamp(start, 0).map(|d| d.to_rfc3339()),
            "durationSeconds": dur,
            "location": location,
        })
    });

    let account_id = crate::commands::app_meta::get(pool, "rsiAccount.activeId").await;
    let blueprints_unlocked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM UserCraftingBlueprintOwned WHERE accountId IS ?")
        .bind(&account_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let spending_total: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(totalPrice), 0.0) FROM TradeJournal
         WHERE action = 'buy' AND totalPrice IS NOT NULL AND (accountId IS ? OR accountId IS NULL)",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0.0);

    Ok(json!({
        "lastSession": last,
        "missions": { "completed": completed },
        "blueprintsUnlocked": blueprints_unlocked,
        "spendingTotal": spending_total,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derniere_session_et_son_lieu() {
        let h = 3600;
        let ev = [(0, "session", None), (100, "location", Some("Area18")), (2 * h, "location", Some("Lorville")), (2 * h + 600, "quantum", None)];
        assert_eq!(last_session(&ev), Some((2 * h, 600, Some("Lorville".to_string()))));
        assert_eq!(last_session(&[(0, "session", None)]), None);
        assert_eq!(last_session(&[]), None);
    }
}
