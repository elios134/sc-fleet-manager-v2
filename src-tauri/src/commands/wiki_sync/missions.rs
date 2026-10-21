// Synchro Wiki des missions (/missions).
use super::*;

/* ════════════════════════  Mission Intel (/missions)  ══════════════════════ */

/// Mappe une mission SC Wiki → table Mission (réplique mapWikiMissionToData V1, ~45
/// champs) et upsert par uuid + clear-then-recreate des MissionBlueprint (loot).
/// Renvoie true si écrite, false si ignorée (uuid/title absent).
///
/// Format des champs JSON aligné sur la LECTURE V2 (MissionIntelPage) :
/// - starSystems : la page affiche la valeur brute → on stocke les noms joints par ", "
///   (et NON un tableau JSON comme V1, qui afficherait les crochets).
/// - reputationGained / cooldownJson : jamais affichés/parsés par la page → JSON (fidèle V1).
pub(crate) async fn upsert_mission(app: &AppHandle, m: &Value) -> Result<bool, String> {
    let Some(uuid) = vstr(m, "uuid") else {
        return Ok(false);
    };
    let Some(title) = vstr(m, "title") else {
        return Ok(false);
    };

    let description = vstr(m, "description");
    let mission_giver = vstr(m, "mission_giver");
    let debug_name = vstr(m, "debug_name");
    let faction_name = m.get("faction").and_then(|f| vstr(f, "name"));
    let faction_uuid = m.get("faction").and_then(|f| vstr(f, "uuid"));
    let faction_type = m.get("faction").and_then(|f| vstr(f, "faction_type"));
    let reward_scope = vstr(m, "reward_scope");
    let illegal = i64::from(vbool(m, "illegal"));
    let legality_label = vstr(m, "legality_label");
    let has_blueprints = i64::from(vbool(m, "has_blueprints"));
    let blueprint_drop_chance = vf64(m, "blueprint_drop_chance");
    let reward_min = vi64(m, "reward_min");
    let reward_max = vi64(m, "reward_max");
    let reward_currency = vstr(m, "reward_currency");
    let time_mins = vi64(m, "time_to_complete_minutes");
    let shareable = i64::from(vbool(m, "shareable"));
    let max_players = vi64(m, "max_players_per_instance").unwrap_or(1);
    let max_instances = vi64(m, "max_instances_per_player").unwrap_or(1);
    let has_combat = i64::from(vbool(m, "has_combat"));
    let has_hauling = i64::from(vbool(m, "has_hauling"));
    let has_defend = i64::from(vbool(m, "has_defend_objective"));
    let enemy_min = vi64(m, "enemy_count_min");
    let enemy_max = vi64(m, "enemy_count_max");
    let min_standing_name = m.get("min_standing").and_then(|s| vstr(s, "name"));
    let min_standing_value = m.get("min_standing").and_then(|s| vi64(s, "min_reputation"));
    let max_standing_name = m.get("max_standing").and_then(|s| vstr(s, "name"));
    let max_standing_value = m.get("max_standing").and_then(|s| vi64(s, "min_reputation"));
    let min_crime = vi64(m, "min_crime_stat");
    let max_crime = vi64(m, "max_crime_stat");
    let available_in_prison = i64::from(vbool(m, "available_in_prison"));
    let released = i64::from(vbool(m, "released"));
    let not_for_release = i64::from(vbool(m, "not_for_release"));
    let work_in_progress = i64::from(vbool(m, "work_in_progress"));
    let reaccept_aband = vbool_opt(m, "reaccept_after_abandoning").map(i64::from);
    let reaccept_fail = vbool_opt(m, "reaccept_after_failing").map(i64::from);

    // starSystems : l'API renvoie un tableau de CHAÎNES (["Nyx","Pyro","Stanton"]),
    // pas d'objets {name} → lire chaque élément comme chaîne. Joint par ", ".
    let star_systems: Option<String> = m
        .get("star_systems")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|s| !s.is_empty());

    // reputationGained / cooldownJson : conservés en JSON (non affichés par la page).
    let reputation_gained: Option<String> = m
        .get("reputation_gained")
        .filter(|v| v.as_array().map(|a| !a.is_empty()).unwrap_or(false))
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .filter(|s| !s.is_empty());
    let cooldown_json: Option<String> = m
        .get("cooldown")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .filter(|s| !s.is_empty());

    let reputation_amount = vi64(m, "reputation_amount");
    let rank_index = vi64(m, "rank_index");
    let game_version = vstr(m, "game_version");
    let web_url = vstr(m, "web_url");

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
        "INSERT INTO Mission
           (uuid, source, title, description, missionGiver, debugName,
            factionName, factionUuid, factionType, rewardScope, illegal, legalityLabel,
            hasBlueprints, blueprintDropChance, rewardMin, rewardMax, rewardCurrency, timeMins,
            shareable, maxPlayersPerInstance, maxInstancesPerPlayer, hasCombat, hasHauling, hasDefend,
            enemyCountMin, enemyCountMax, minStandingName, minStandingValue, maxStandingName, maxStandingValue,
            minCrimeStat, maxCrimeStat, availableInPrison, released, notForRelease, workInProgress,
            reacceptAfterAbandoning, reacceptAfterFailing, starSystems, reputationGained, cooldownJson,
            reputationAmount, rankIndex, gameVersion, webUrl, lastSyncedAt)
         VALUES (?, 'wiki', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(uuid) DO UPDATE SET
           source='wiki', title=excluded.title, description=excluded.description,
           missionGiver=excluded.missionGiver, debugName=excluded.debugName,
           factionName=excluded.factionName, factionUuid=excluded.factionUuid,
           factionType=excluded.factionType, rewardScope=excluded.rewardScope,
           illegal=excluded.illegal, legalityLabel=excluded.legalityLabel,
           hasBlueprints=excluded.hasBlueprints, blueprintDropChance=excluded.blueprintDropChance,
           rewardMin=excluded.rewardMin, rewardMax=excluded.rewardMax,
           rewardCurrency=excluded.rewardCurrency, timeMins=excluded.timeMins,
           shareable=excluded.shareable, maxPlayersPerInstance=excluded.maxPlayersPerInstance,
           maxInstancesPerPlayer=excluded.maxInstancesPerPlayer, hasCombat=excluded.hasCombat,
           hasHauling=excluded.hasHauling, hasDefend=excluded.hasDefend,
           enemyCountMin=excluded.enemyCountMin, enemyCountMax=excluded.enemyCountMax,
           minStandingName=excluded.minStandingName, minStandingValue=excluded.minStandingValue,
           maxStandingName=excluded.maxStandingName, maxStandingValue=excluded.maxStandingValue,
           minCrimeStat=excluded.minCrimeStat, maxCrimeStat=excluded.maxCrimeStat,
           availableInPrison=excluded.availableInPrison, released=excluded.released,
           notForRelease=excluded.notForRelease, workInProgress=excluded.workInProgress,
           reacceptAfterAbandoning=excluded.reacceptAfterAbandoning,
           reacceptAfterFailing=excluded.reacceptAfterFailing, starSystems=excluded.starSystems,
           reputationGained=excluded.reputationGained, cooldownJson=excluded.cooldownJson,
           reputationAmount=excluded.reputationAmount, rankIndex=excluded.rankIndex,
           gameVersion=excluded.gameVersion, webUrl=excluded.webUrl, lastSyncedAt=datetime('now')",
    )
    .bind(&uuid)
    .bind(&title)
    .bind(description)
    .bind(mission_giver)
    .bind(debug_name)
    .bind(faction_name)
    .bind(faction_uuid)
    .bind(faction_type)
    .bind(reward_scope)
    .bind(illegal)
    .bind(legality_label)
    .bind(has_blueprints)
    .bind(blueprint_drop_chance)
    .bind(reward_min)
    .bind(reward_max)
    .bind(reward_currency)
    .bind(time_mins)
    .bind(shareable)
    .bind(max_players)
    .bind(max_instances)
    .bind(has_combat)
    .bind(has_hauling)
    .bind(has_defend)
    .bind(enemy_min)
    .bind(enemy_max)
    .bind(min_standing_name)
    .bind(min_standing_value)
    .bind(max_standing_name)
    .bind(max_standing_value)
    .bind(min_crime)
    .bind(max_crime)
    .bind(available_in_prison)
    .bind(released)
    .bind(not_for_release)
    .bind(work_in_progress)
    .bind(reaccept_aband)
    .bind(reaccept_fail)
    .bind(star_systems)
    .bind(reputation_gained)
    .bind(cooldown_json)
    .bind(reputation_amount)
    .bind(rank_index)
    .bind(game_version)
    .bind(web_url)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Blueprints (loot) : clear-then-recreate par mission.
    sqlx::query("DELETE FROM MissionBlueprint WHERE missionUuid = ?")
        .bind(&uuid)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(arr) = m.get("blueprints").and_then(|b| b.as_array()) {
        for b in arr {
            if let (Some(name), Some(item_uuid)) = (vstr(b, "name"), vstr(b, "uuid")) {
                sqlx::query(
                    "INSERT INTO MissionBlueprint (missionUuid, name, itemUuid) VALUES (?, ?, ?)",
                )
                .bind(&uuid)
                .bind(&name)
                .bind(&item_uuid)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(true)
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct MissionSyncResult {
    pub(crate) missionsSynced: i64,
    pub(crate) errors: i64,
}
