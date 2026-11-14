// « Reprendre ma partie » (spec docs/specs/2026-11-15-reputation-reprendre.md) : frise de la dernière
// session lue dans GameLogEvent. Même découpage en sessions que le Carnet (marqueur de connexion ou
// trou de plus de 45 min). Les missions terminées portent leur réputation (wiki) et leurs plans reçus.
use serde_json::{json, Value};
use sqlx::Row;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::commands::reputation::{domaine::loot_after, iso_ms, log_missions, wiki_rep};
use crate::DB_URL;

const SESSION_GAP_MS: i64 = 45 * 60 * 1000;
const MAX_ITEMS: usize = 14;

/// Index du premier événement de la dernière session (événements triés par date).
pub(crate) fn last_session_start(events: &[(i64, &str)]) -> usize {
    let mut start = 0;
    for i in 1..events.len() {
        if events[i].1 == "session" || events[i].0 - events[i - 1].0 > SESSION_GAP_MS {
            start = i;
        }
    }
    start
}

/// Regroupe les sauts quantiques consécutifs en un seul élément (nombre + dernière destination).
pub(crate) fn group_quantum(items: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for it in items {
        if it["kind"] == "quantum" {
            if let Some(last) = out.last_mut().filter(|l| l["kind"] == "quantum") {
                last["count"] = json!(last["count"].as_i64().unwrap_or(1) + 1);
                last["destination"] = it["destination"].clone();
                last["at"] = it["at"].clone();
                continue;
            }
        }
        out.push(it);
    }
    out
}

#[tauri::command]
pub async fn get_last_session(db: State<'_, DbInstances>) -> Result<Value, String> {
    let lock = db.0.read().await;
    let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) else {
        return Err(format!("Base de données non chargée : {DB_URL}"));
    };
    let rows = sqlx::query(
        "SELECT kind, detail, occurredAt FROM GameLogEvent WHERE occurredAt IS NOT NULL ORDER BY occurredAt ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let events: Vec<(i64, String, Value, String)> = rows
        .into_iter()
        .filter_map(|r| {
            let at: String = r.try_get("occurredAt").ok()?;
            let detail = r.try_get::<String, _>("detail").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
            Some((iso_ms(&at)?, r.try_get("kind").ok()?, detail, at))
        })
        .collect();
    if events.is_empty() {
        return Ok(Value::Null);
    }
    let keys: Vec<(i64, &str)> = events.iter().map(|e| (e.0, e.1.as_str())).collect();
    let session = &events[last_session_start(&keys)..];

    let (missions, blueprints) = log_missions(pool).await?;
    let mut location = None;
    let mut system = None;
    let mut items = Vec::new();
    for (ms, kind, d, at) in session {
        let s = |k: &str| d.get(k).and_then(|v| v.as_str()).map(str::to_string);
        match kind.as_str() {
            "location" => location = s("zone").or(location),
            "system" => {
                system = s("system").or(system);
                items.push(json!({ "kind": "system", "at": at, "system": s("system") }));
            }
            "session" => items.push(json!({ "kind": "login", "at": at, "character": s("character") })),
            "vehicle" if s("event").as_deref() != Some("destruction") => items.push(json!({ "kind": "vehicle", "at": at, "vehicle": s("vehicle") })),
            "death" => items.push(json!({ "kind": "death", "at": at, "zone": s("zone"), "killer": s("killer"), "victim": s("victim") })),
            "quantum" => items.push(json!({ "kind": "quantum", "at": at, "count": 1, "destination": s("destination") })),
            "mission_title" => items.push(json!({ "kind": "accepted", "at": at, "title": s("title") })),
            "mission" => {
                let m = s("missionId").and_then(|id| missions.get(&id));
                let rep = match m.and_then(|m| m.contract.as_deref()) {
                    Some(c) => wiki_rep(pool, c).await,
                    None => Vec::new(),
                };
                items.push(json!({
                    "kind": "ended",
                    "at": at,
                    "outcome": s("outcome"),
                    "title": m.and_then(|m| m.title.clone()),
                    "rep": rep.iter().map(|g| json!({ "faction": g.faction, "amount": g.amount })).collect::<Vec<_>>(),
                    "loot": loot_after(*ms, &blueprints, 60_000),
                }));
            }
            _ => {}
        }
    }
    let mut items = group_quantum(items);
    items.reverse();
    items.truncate(MAX_ITEMS);
    let first = session.first().map(|e| e.0).unwrap_or(0);
    let last = session.last().map(|e| e.0).unwrap_or(0);
    Ok(json!({
        "start": session.first().map(|e| e.3.clone()),
        "durationSeconds": (last - first) / 1000,
        "location": location,
        "system": system,
        "items": items,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derniere_session_par_connexion_ou_trou() {
        let h = 3_600_000;
        assert_eq!(last_session_start(&[(0, "location"), (h, "session"), (h + 10, "quantum")]), 1);
        assert_eq!(last_session_start(&[(0, "session"), (10, "quantum"), (2 * h, "location"), (2 * h + 5, "quantum")]), 2);
        assert_eq!(last_session_start(&[(0, "session"), (10, "quantum")]), 0);
    }

    #[test]
    fn sauts_quantiques_regroupes() {
        let q = |d: &str| json!({ "kind": "quantum", "at": d, "count": 1, "destination": d });
        let out = group_quantum(vec![q("A"), q("B"), json!({ "kind": "login" }), q("C")]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0]["count"], 2);
        assert_eq!(out[0]["destination"], "B");
    }
}
