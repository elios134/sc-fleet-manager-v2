// Onglet Réputation (spec docs/specs/2026-11-15-reputation-reprendre.md) : tout est recalculé à la
// demande depuis GameLogEvent (contrats, titres, fins de mission, plans reçus) et la table Mission
// du wiki. Seul le rang corrigé à la main est stocké (UserFactionReputation).
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
use domaine::*;

macro_rules! pool {
    ($lock:expr) => {
        match $lock.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => return Err(format!("Base de données non chargée : {DB_URL}")),
        }
    };
}

/// Fenêtre de rattachement des plans reçus à la mission qui vient de se terminer.
const LOOT_WINDOW_MS: i64 = 60_000;
const ADVICE_LIMIT: usize = 8;

pub(crate) fn iso_ms(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso).ok().map(|d| d.timestamp_millis())
}

async fn account(pool: &SqlitePool) -> Result<String, String> {
    crate::commands::notifications::active_account_id(pool).await?.ok_or_else(|| "NO_ACTIVE_ACCOUNT".to_string())
}

/// Échelles de rangs par scope.
async fn ladders(pool: &SqlitePool) -> Result<HashMap<String, Vec<RankDef>>, String> {
    let rows = sqlx::query("SELECT scopeId, name, minReputation, rangeXP FROM Rank ORDER BY scopeId, rankIndex")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut out: HashMap<String, Vec<RankDef>> = HashMap::new();
    for r in rows {
        let scope: String = r.try_get("scopeId").unwrap_or_default();
        out.entry(scope).or_default().push(RankDef {
            name: r.try_get("name").unwrap_or_default(),
            min: r.try_get::<Option<i64>, _>("minReputation").ok().flatten().unwrap_or(0),
            range: r.try_get::<Option<i64>, _>("rangeXP").ok().flatten(),
        });
    }
    Ok(out)
}

/// Mission du wiki par nom de contrat.
struct WikiMission {
    title: Option<String>,
    faction: Option<String>,
    gains: Vec<RepGain>,
    min_standing: Option<String>,
}

async fn wiki_mission(pool: &SqlitePool, contract: &str) -> Option<WikiMission> {
    let r = sqlx::query("SELECT title, factionName, reputationGained, minStandingName FROM Mission WHERE debugName = ? LIMIT 1")
        .bind(contract)
        .fetch_optional(pool)
        .await
        .ok()??;
    Some(WikiMission {
        title: r.try_get("title").ok().flatten(),
        faction: r.try_get("factionName").ok().flatten(),
        gains: parse_gains(r.try_get::<Option<String>, _>("reputationGained").ok().flatten().as_deref()),
        min_standing: r.try_get("minStandingName").ok().flatten(),
    })
}

/// Gains de réputation d'un contrat (frise « Reprendre ma partie »).
pub(crate) async fn wiki_rep(pool: &SqlitePool, contract: &str) -> Vec<RepGain> {
    wiki_mission(pool, contract).await.map(|w| w.gains).unwrap_or_default()
}

/// Événements de mission du Game.log, regroupés par missionId.
#[derive(Default)]
pub(crate) struct LogMission {
    pub contract: Option<String>,
    pub title: Option<String>,
    pub accepted_at: Option<String>,
    pub ended_at: Option<String>,
    pub outcome: Option<String>,
}

pub(crate) async fn log_missions(pool: &SqlitePool) -> Result<(BTreeMap<String, LogMission>, Vec<(i64, String)>), String> {
    let rows = sqlx::query(
        "SELECT kind, detail, occurredAt FROM GameLogEvent
         WHERE kind IN ('mission', 'mission_contract', 'mission_title', 'blueprint') AND occurredAt IS NOT NULL
         ORDER BY occurredAt ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut missions: BTreeMap<String, LogMission> = BTreeMap::new();
    let mut blueprints = Vec::new();
    for r in rows {
        let kind: String = r.try_get("kind").unwrap_or_default();
        let at: String = r.try_get("occurredAt").unwrap_or_default();
        let detail: Value = r.try_get::<String, _>("detail").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let s = |k: &str| detail.get(k).and_then(|v| v.as_str()).map(str::to_string);
        if kind == "blueprint" {
            if let (Some(ms), Some(n)) = (iso_ms(&at), s("name")) {
                blueprints.push((ms, n));
            }
            continue;
        }
        let Some(id) = s("missionId") else { continue };
        let m = missions.entry(id).or_default();
        match kind.as_str() {
            "mission_contract" => {
                m.contract = s("contract");
                m.accepted_at.get_or_insert(at);
            }
            "mission_title" => {
                m.title = s("title");
                m.accepted_at.get_or_insert(at);
            }
            _ => {
                m.ended_at = Some(at);
                m.outcome = s("outcome");
            }
        }
    }
    Ok((missions, blueprints))
}

#[derive(Default)]
struct Tracker {
    gained: i64,
    gained_since_declared: i64,
    missions: i64,
    last_at: String,
    journal: Vec<Value>,
    deduced: Option<(usize, String, String)>, // (rang, titre, date)
}

/// Réputation par (faction, échelle) : rang, progression, journal, missions conseillées.
#[tauri::command]
pub async fn get_reputation_overview(db: State<'_, DbInstances>) -> Result<Value, String> {
    let lock = db.0.read().await;
    let pool = pool!(lock);
    let account_id = account(pool).await?;
    let ladders = ladders(pool).await?;
    let scope_labels: HashMap<String, String> = sqlx::query("SELECT id, displayName FROM Scope")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|r| Some((r.try_get("id").ok()?, r.try_get("displayName").ok()?)))
        .collect();
    let declared: HashMap<(String, String), (usize, i64, String)> =
        sqlx::query("SELECT faction, scopeId, rankIndex, repInRank, declaredAt FROM UserFactionReputation WHERE accountId = ?")
            .bind(&account_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter_map(|r| {
                let k = (r.try_get("faction").ok()?, r.try_get("scopeId").ok()?);
                Some((k, (r.try_get::<i64, _>("rankIndex").ok()? as usize, r.try_get("repInRank").ok()?, r.try_get("declaredAt").ok()?)))
            })
            .collect();

    let (missions, blueprints) = log_missions(pool).await?;
    let mut wiki: HashMap<String, Option<WikiMission>> = HashMap::new();
    let mut trackers: HashMap<(String, String), Tracker> = HashMap::new();
    let mut accepted: Vec<(String, String, String, String)> = Vec::new(); // faction, rang requis, titre, date
    let mut unmatched = 0;
    for m in missions.values() {
        let Some(contract) = &m.contract else { continue };
        if !wiki.contains_key(contract) {
            let w = wiki_mission(pool, contract).await;
            wiki.insert(contract.clone(), w);
        }
        let Some(w) = wiki.get(contract).and_then(|w| w.as_ref()) else {
            if m.outcome.as_deref() == Some("completed") {
                unmatched += 1;
            }
            continue;
        };
        let title = m.title.clone().or_else(|| w.title.clone()).unwrap_or_else(|| contract.clone());
        if let (Some(f), Some(rank), Some(at)) = (&w.faction, &w.min_standing, &m.accepted_at) {
            accepted.push((f.clone(), rank.clone(), title.clone(), at.clone()));
        }
        if m.outcome.as_deref() != Some("completed") {
            continue;
        }
        let end = m.ended_at.clone().unwrap_or_default();
        let loot = iso_ms(&end).map(|ms| loot_after(ms, &blueprints, LOOT_WINDOW_MS)).unwrap_or_default();
        for g in w.gains.iter().filter(|g| ladders.contains_key(&g.scope)) {
            let key = (g.faction.clone(), g.scope.clone());
            let t = trackers.entry(key.clone()).or_default();
            t.gained += g.amount;
            if declared.get(&key).is_none_or(|d| end > d.2) {
                t.gained_since_declared += g.amount;
            }
            t.missions += 1;
            if end > t.last_at {
                t.last_at = end.clone();
            }
            t.journal.push(json!({ "at": end, "title": title, "amount": g.amount, "loot": loot }));
        }
    }

    let mut out = Vec::new();
    for ((faction, scope), mut t) in trackers {
        let ladder = &ladders[&scope];
        for (_, rank, title, at) in accepted.iter().filter(|a| a.0 == faction) {
            if let Some(i) = rank_index_of(ladder, rank) {
                if t.deduced.as_ref().is_none_or(|d| i > d.0) {
                    t.deduced = Some((i, title.clone(), at.clone()));
                }
            }
        }
        let decl = declared.get(&(faction.clone(), scope.clone()));
        let (source, total) = match (decl, &t.deduced) {
            (Some(d), _) => ("declared", base_total(ladder, Some(d.0), d.1) + t.gained_since_declared),
            (None, Some(d)) => ("deduced", base_total(ladder, Some(d.0), 0) + t.gained),
            (None, None) => ("unknown", t.gained),
        };
        let st = standing_at(ladder, total);
        let candidates = candidates(pool, &faction, &scope).await?;
        let advice = advise(ladder, st.rank_index, &candidates, ADVICE_LIMIT);
        t.journal.sort_by(|a, b| b["at"].as_str().cmp(&a["at"].as_str()));
        out.push(json!({
            "faction": faction,
            "scopeId": scope,
            "scopeLabel": scope_labels.get(&scope),
            "monogram": monogram(&faction),
            "ranks": ladder.iter().map(|r| json!({ "name": r.name, "min": r.min, "range": r.range })).collect::<Vec<_>>(),
            "total": st.total,
            "rankIndex": st.rank_index,
            "inRank": st.in_rank,
            "toNext": st.to_next,
            "rankSource": source,
            "deduced": t.deduced.as_ref().map(|d| json!({ "rankName": ladder[d.0].name, "title": d.1, "at": d.2 })),
            "declared": decl.map(|d| json!({ "rankIndex": d.0, "repInRank": d.1, "at": d.2 })),
            "gained": t.gained,
            "missions": t.missions,
            "lastAt": t.last_at,
            "journal": t.journal,
            "advice": advice.iter().map(|a| json!({ "title": a.title, "amount": a.amount, "timeMins": a.time_mins, "perHour": a.per_hour, "minRank": a.min_rank })).collect::<Vec<_>>(),
            "missionsLeft": missions_left(st.to_next, &advice),
        }));
    }
    out.sort_by(|a, b| b["lastAt"].as_str().cmp(&a["lastAt"].as_str()));
    Ok(json!({ "factions": out, "unmatched": unmatched }))
}

async fn candidates(pool: &SqlitePool, faction: &str, scope: &str) -> Result<Vec<Candidate>, String> {
    let rows = sqlx::query(
        "SELECT title, reputationGained, CAST(timeMins AS REAL) AS timeMins, minStandingName, maxStandingName FROM Mission
         WHERE factionName = ? AND reputationGained IS NOT NULL",
    )
    .bind(faction)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let gains = parse_gains(r.try_get::<Option<String>, _>("reputationGained").ok().flatten().as_deref());
            let amount = gains.iter().find(|g| g.faction == faction && g.scope == scope)?.amount;
            Some(Candidate {
                title: r.try_get::<Option<String>, _>("title").ok().flatten()?,
                amount,
                time_mins: r.try_get::<Option<f64>, _>("timeMins").ok().flatten().map(|v| v.round() as i64),
                min_standing: r.try_get("minStandingName").ok().flatten(),
                max_standing: r.try_get("maxStandingName").ok().flatten(),
            })
        })
        .collect())
}

/// « Corriger mon rang » : rang + réputation dans ce rang, à partir de maintenant.
#[tauri::command]
pub async fn set_faction_rank(db: State<'_, DbInstances>, faction: String, scope_id: String, rank_index: i64, rep_in_rank: i64) -> Result<(), String> {
    if rank_index < 0 || rep_in_rank < 0 {
        return Err("Rang et réputation doivent être positifs.".into());
    }
    let lock = db.0.read().await;
    let pool = pool!(lock);
    let account_id = account(pool).await?;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query(
        "INSERT INTO UserFactionReputation (accountId, faction, scopeId, rankIndex, repInRank, declaredAt) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(accountId, faction, scopeId) DO UPDATE SET rankIndex = excluded.rankIndex, repInRank = excluded.repInRank, declaredAt = excluded.declaredAt",
    )
    .bind(&account_id)
    .bind(&faction)
    .bind(&scope_id)
    .bind(rank_index)
    .bind(rep_in_rank)
    .bind(&now)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Revient au rang déduit (supprime la correction).
#[tauri::command]
pub async fn clear_faction_rank(db: State<'_, DbInstances>, faction: String, scope_id: String) -> Result<(), String> {
    let lock = db.0.read().await;
    let pool = pool!(lock);
    let account_id = account(pool).await?;
    sqlx::query("DELETE FROM UserFactionReputation WHERE accountId = ? AND faction = ? AND scopeId = ?")
        .bind(&account_id)
        .bind(&faction)
        .bind(&scope_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(crate) mod domaine;
