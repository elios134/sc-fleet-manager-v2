// Phase 1.1 — Lecteur Game.log (fondation).
//
// Tâche de fond qui « tail » le Game.log de l'installation Star Citizen, parse chaque
// nouvelle ligne en événement typé, le persiste (GameLogEvent) et l'émet au front
// (event Tauri `gamelog:event`). Le lieu courant est mémorisé (AppMeta
// `gamelog.currentLocation`) et diffusé (`gamelog:location`) — il nourrit le GPS de
// trading (Phase 1.2). Achats/ventes alimentent le journal (Phase 1.3).
//
// OPT-IN : désactivé par défaut (AppMeta `gamelog.enabled`). 100 % LOCAL, lecture seule.
//
// Robustesse format : les motifs de lignes SC évoluent à chaque patch. Tout le parsing
// est CENTRALISÉ dans le module `parse` ci-dessous et couvert par des tests unitaires sur
// des lignes-échantillons — un changement de format ne touche qu'un endroit.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const POLL_INTERVAL_SECS: u64 = 2;
const BOOT_DELAY_SECS: u64 = 9; // après le monitor notifications, laisse la DB se charger
const MAX_CHUNK_BYTES: u64 = 4 * 1024 * 1024; // garde-fou anti-explosion mémoire

/* ════════════════════════════════ Parsing ════════════════════════════════ */
// Module isolé et testable : aucune I/O, aucune dépendance Tauri.

pub mod parse {
    use serde_json::{json, Value};

    #[derive(Debug, Clone, PartialEq)]
    pub struct ParsedEvent {
        pub kind: &'static str,
        pub summary: String,
        pub detail: Value,
        pub occurred_at: Option<String>,
    }

    /// Horodatage en tête de ligne : `<2026-06-27T16:00:00.000Z> …`.
    fn timestamp(line: &str) -> Option<String> {
        let re = regex::Regex::new(r"^<([0-9T:\.\-]+Z)>").ok()?;
        re.captures(line)?.get(1).map(|m| m.as_str().to_string())
    }

    /// Mort d'acteur (format documenté `<Actor Death> CActor::Kill: …`).
    fn parse_death(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
        let re = regex::Regex::new(
            r"CActor::Kill: '([^']+)' \[\d+\] in zone '([^']*)' killed by '([^']+)' \[\d+\] using '([^']+)'",
        )
        .ok()?;
        let c = re.captures(line)?;
        let victim = c.get(1)?.as_str();
        let zone = c.get(2)?.as_str();
        let killer = c.get(3)?.as_str();
        let weapon = c.get(4)?.as_str();
        let summary = if victim == killer {
            format!("{victim} s'est auto-détruit ({zone})")
        } else {
            format!("{victim} tué par {killer} — {weapon}")
        };
        Some(ParsedEvent {
            kind: "death",
            summary,
            detail: json!({ "victim": victim, "killer": killer, "weapon": weapon, "zone": zone }),
            occurred_at: ts.clone(),
        })
    }

    /// Changement de zone / lieu (entrée d'un acteur local dans une zone nommée).
    fn parse_location(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
        // Marqueur courant : OnEntityEnterZone avec un nom de zone parlant.
        let re = regex::Regex::new(r"OnEntityEnterZone.*?[Zz]one(?:Name)?[ '\[]+([A-Za-z0-9_@\-]+)")
            .ok()?;
        let c = re.captures(line)?;
        let zone = c.get(1)?.as_str();
        // On ignore les zones techniques sans intérêt (vides / underscore pur).
        if zone.is_empty() {
            return None;
        }
        Some(ParsedEvent {
            kind: "location",
            summary: format!("Lieu : {zone}"),
            detail: json!({ "zone": zone }),
            occurred_at: ts.clone(),
        })
    }

    /// Voyage quantique (départ vers une destination).
    fn parse_quantum(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
        if !line.contains("QuantumTravel") && !line.contains("Quantum Travel") {
            return None;
        }
        let dest = regex::Regex::new(r"(?:to|destination)[ '\[:=]+([A-Za-z0-9_@\-]+)")
            .ok()
            .and_then(|re| re.captures(line))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        Some(ParsedEvent {
            kind: "quantum",
            summary: match &dest {
                Some(d) => format!("Saut quantique → {d}"),
                None => "Saut quantique".to_string(),
            },
            detail: json!({ "destination": dest }),
            occurred_at: ts.clone(),
        })
    }

    /// Destruction de véhicule (`<Vehicle Destruction>` / CVehicle::OnAdvanceDestroyLevel).
    fn parse_vehicle(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
        if !line.contains("Vehicle Destruction") && !line.contains("OnAdvanceDestroyLevel") {
            return None;
        }
        let vehicle = regex::Regex::new(r"[Vv]ehicle '([^']+)'")
            .ok()
            .and_then(|re| re.captures(line))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        Some(ParsedEvent {
            kind: "vehicle",
            summary: match &vehicle {
                Some(v) => format!("Véhicule détruit : {v}"),
                None => "Véhicule détruit".to_string(),
            },
            detail: json!({ "vehicle": vehicle }),
            occurred_at: ts.clone(),
        })
    }

    /// Transaction marchande (achat/vente de cargo). CONSERVATEUR : exige le marqueur
    /// « commodity » + un verbe d'action pour éviter tout faux positif. Les formats exacts
    /// des kiosques marchands varient selon les patchs SC — motifs à ajuster sur logs réels.
    /// detail : { action, commodity, scu, unitPrice, totalPrice, location }.
    fn parse_commodity(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
        let lower = line.to_lowercase();
        if !lower.contains("commodity") {
            return None;
        }
        let action = if lower.contains("purchase") || lower.contains("bought") {
            "buy"
        } else if lower.contains("sold") || lower.contains("sell") {
            "sell"
        } else {
            return None;
        };
        let cap1 = |re: &str| {
            regex::Regex::new(re)
                .ok()
                .and_then(|r| r.captures(line))
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
        };
        let commodity = cap1(r"[Cc]ommodity[ '\[:=]+([A-Za-z0-9_@\- ]+?)['\]]").unwrap_or_default();
        let scu = cap1(r"([0-9]+(?:\.[0-9]+)?)\s*SCU").and_then(|s| s.parse::<f64>().ok());
        let total = cap1(r"(?:for|total|price)[ :=]+\$?([0-9]+(?:\.[0-9]+)?)")
            .and_then(|s| s.parse::<f64>().ok());
        let unit = match (total, scu) {
            (Some(t), Some(s)) if s > 0.0 => Some(t / s),
            _ => None,
        };
        let kind = if action == "buy" { "commodity_buy" } else { "commodity_sell" };
        let label = if action == "buy" { "Achat" } else { "Vente" };
        let summary = if commodity.is_empty() {
            format!("{label} de cargo")
        } else {
            format!("{label} : {commodity}{}", scu.map(|s| format!(" ({s} SCU)")).unwrap_or_default())
        };
        Some(ParsedEvent {
            kind,
            summary,
            detail: json!({
                "action": action,
                "commodity": commodity,
                "scu": scu,
                "unitPrice": unit,
                "totalPrice": total,
            }),
            occurred_at: ts.clone(),
        })
    }

    /// Parse une ligne en un événement, ou None si non reconnue. L'ordre = priorité.
    pub fn parse_line(line: &str) -> Option<ParsedEvent> {
        let line = line.trim_end();
        if line.is_empty() {
            return None;
        }
        let ts = timestamp(line);
        parse_death(line, &ts)
            .or_else(|| parse_commodity(line, &ts))
            .or_else(|| parse_vehicle(line, &ts))
            .or_else(|| parse_quantum(line, &ts))
            .or_else(|| parse_location(line, &ts))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_actor_death() {
            let line = "<2026-06-27T16:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'Jdoe' [12345] in zone 'Stanton_Hurston' killed by 'Pirate_NPC' [67890] using 'ballistic_rifle' [Class Weapon] with damage type 'Bullet'";
            let ev = parse_line(line).expect("death parsé");
            assert_eq!(ev.kind, "death");
            assert_eq!(ev.detail["victim"], "Jdoe");
            assert_eq!(ev.detail["killer"], "Pirate_NPC");
            assert_eq!(ev.detail["weapon"], "ballistic_rifle");
            assert_eq!(ev.occurred_at.as_deref(), Some("2026-06-27T16:00:00.000Z"));
        }

        #[test]
        fn suicide_summary_differs() {
            let line = "<2026-06-27T16:00:00.000Z> <Actor Death> CActor::Kill: 'Jdoe' [1] in zone 'Area18' killed by 'Jdoe' [1] using 'Suicide'";
            let ev = parse_line(line).expect("death parsé");
            assert!(ev.summary.contains("auto-détruit"));
        }

        #[test]
        fn parses_quantum_travel() {
            let line = "<2026-06-27T16:01:00.000Z> [Notice] QuantumTravel started to 'CRU_L1'";
            let ev = parse_line(line).expect("quantum parsé");
            assert_eq!(ev.kind, "quantum");
            assert_eq!(ev.detail["destination"], "CRU_L1");
        }

        #[test]
        fn ignores_unrelated_lines() {
            assert!(parse_line("<2026-06-27T16:02:00.000Z> [Notice] <CrashHandler> nothing here").is_none());
            assert!(parse_line("").is_none());
        }
    }
}

/* ════════════════════════════ Accès base (helpers) ════════════════════════ */

async fn meta_get(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
}

async fn meta_set(pool: &SqlitePool, key: &str, value: &str) {
    let _ = sqlx::query(
        "INSERT INTO AppMeta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await;
}

async fn active_account_id(pool: &SqlitePool) -> Option<String> {
    meta_get(pool, "rsiAccount.activeId").await
}

/* ═════════════════════════════ Résolution chemin ══════════════════════════ */

/// Chemin du Game.log à partir de l'install SC résolue (configuré prioritaire).
async fn resolve_gamelog_path(pool: &SqlitePool) -> Option<std::path::PathBuf> {
    let configured = meta_get(pool, "datamining.scInstallPath").await;
    let (install, _channel) = super::patch_detect::resolve_sc_install(configured)?;
    let p = std::path::Path::new(&install).join("Game.log");
    Some(p)
}

/* ═════════════════════════════ Dispatch d'un événement ════════════════════ */

async fn persist_and_emit(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &Option<String>,
    ev: &parse::ParsedEvent,
    emit: bool,
) {
    let detail_str = ev.detail.to_string();
    let _ = sqlx::query(
        "INSERT INTO GameLogEvent (accountId, kind, summary, detail, occurredAt)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(account_id)
    .bind(ev.kind)
    .bind(&ev.summary)
    .bind(&detail_str)
    .bind(&ev.occurred_at)
    .execute(pool)
    .await;

    // Lieu courant : mémorisé + diffusé (nourrit le GPS de trading).
    if ev.kind == "location" {
        if let Some(zone) = ev.detail.get("zone").and_then(|v| v.as_str()) {
            meta_set(pool, "gamelog.currentLocation", zone).await;
            if emit {
                let _ = app.emit("gamelog:location", json!({ "location": zone }));
            }
        }
    }

    // Transaction marchande : alimente le journal de commerce (Phase 1.3) au lieu courant.
    if ev.kind == "commodity_buy" || ev.kind == "commodity_sell" {
        let action = ev.detail.get("action").and_then(|v| v.as_str()).unwrap_or("buy");
        let commodity = ev.detail.get("commodity").and_then(|v| v.as_str()).unwrap_or("");
        let scu = ev.detail.get("scu").and_then(|v| v.as_f64());
        let unit = ev.detail.get("unitPrice").and_then(|v| v.as_f64());
        let total = ev.detail.get("totalPrice").and_then(|v| v.as_f64());
        let location = meta_get(pool, "gamelog.currentLocation").await;
        let _ = sqlx::query(
            "INSERT INTO TradeJournal (accountId, action, commodity, scu, unitPrice, totalPrice, location, source, occurredAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'gamelog', ?)",
        )
        .bind(account_id)
        .bind(action)
        .bind(commodity)
        .bind(scu)
        .bind(unit)
        .bind(total)
        .bind(&location)
        .bind(&ev.occurred_at)
        .execute(pool)
        .await;
        if emit {
            let _ = app.emit("trade:journal", ev.detail.clone());
        }
    }

    if emit {
        let _ = app.emit(
            "gamelog:event",
            json!({ "kind": ev.kind, "summary": ev.summary, "detail": ev.detail, "occurredAt": ev.occurred_at }),
        );
    }
}

/* ═════════════════════════════ Boucle de tail ═════════════════════════════ */

/// Lit l'incrément du fichier depuis `offset`, renvoie (nouveau_contenu, nouvel_offset).
/// Gère la rotation (fichier tronqué/recréé → relecture depuis 0).
fn read_increment(path: &std::path::Path, offset: u64) -> std::io::Result<(String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = if len < offset { 0 } else { offset }; // rotation détectée
    let to_read = len.saturating_sub(start).min(MAX_CHUNK_BYTES);
    if to_read == 0 {
        return Ok((String::new(), len));
    }
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; to_read as usize];
    file.read_exact(&mut buf)?;
    // Lecture lossy : les logs SC sont ASCII/UTF-8 mais on ne panique jamais.
    Ok((String::from_utf8_lossy(&buf).into_owned(), start + to_read))
}

/// Un passage de tail : lit l'incrément, parse, persiste + émet. Best-effort.
async fn tail_once(app: &AppHandle, pool: &SqlitePool) {
    let Some(path) = resolve_gamelog_path(pool).await else {
        return;
    };
    if !path.is_file() {
        return;
    }
    let path_str = path.to_string_lossy().to_string();

    // Offset courant + détection de changement de fichier (nouvelle install/canal).
    let stored_path = meta_get(pool, "gamelog.path").await.unwrap_or_default();
    let mut offset: u64 = meta_get(pool, "gamelog.offset")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if stored_path != path_str {
        offset = 0;
        meta_set(pool, "gamelog.path", &path_str).await;
    }

    let (chunk, new_offset) = match read_increment(&path, offset) {
        Ok(v) => v,
        Err(_) => return,
    };
    if new_offset != offset {
        meta_set(pool, "gamelog.offset", &new_offset.to_string()).await;
    }
    if chunk.is_empty() {
        return;
    }

    let account_id = active_account_id(pool).await;
    for line in chunk.lines() {
        if let Some(ev) = parse::parse_line(line) {
            persist_and_emit(app, pool, &account_id, &ev, true).await;
        }
    }
}

/// Un cycle complet : récupère le pool, vérifie l'activation, tail si activé. Best-effort
/// (no-op si DB pas chargée ou lecteur désactivé).
async fn run_tail_cycle(app: &AppHandle) {
    let Some(instances) = app.try_state::<DbInstances>() else {
        return;
    };
    let guard = instances.0.read().await;
    let pool = match guard.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return, // DB pas encore chargée
    };
    if meta_get(pool, "gamelog.enabled").await.as_deref() != Some("1") {
        return; // lecteur désactivé (opt-in)
    }
    tail_once(app, pool).await;
}

/// Démarre la surveillance du Game.log. Tourne en permanence mais ne tail QUE si
/// `gamelog.enabled` est vrai. Toggle pris en compte au prochain tick (≤ 2 s).
pub fn spawn_gamelog_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BOOT_DELAY_SECS)).await;
        loop {
            run_tail_cycle(&app).await;
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });
}

/* ════════════════════════════════ Commandes ══════════════════════════════ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogStatus {
    enabled: bool,
    resolved_path: Option<String>,
    path_exists: bool,
    current_location: Option<String>,
}

/// Extrait le pool SQLite du guard (pattern inline partagé par les commandes).
macro_rules! sqlite_pool {
    ($instances:expr) => {{
        match $instances.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            #[allow(unreachable_patterns)]
            _ => return Err(format!("Base de données non chargée : {DB_URL}")),
        }
    }};
}

/// Statut du lecteur Game.log (activé, chemin résolu, lieu courant).
#[tauri::command]
pub async fn get_gamelog_status(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<GameLogStatus, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let enabled = meta_get(pool, "gamelog.enabled").await.as_deref() == Some("1");
    let path = resolve_gamelog_path(pool).await;
    let path_exists = path.as_ref().map(|p| p.is_file()).unwrap_or(false);
    Ok(GameLogStatus {
        enabled,
        resolved_path: path.map(|p| p.to_string_lossy().to_string()),
        path_exists,
        current_location: meta_get(pool, "gamelog.currentLocation").await,
    })
}

/// Active/désactive le lecteur. À l'activation, on cale l'offset sur la FIN du fichier
/// (on ne rejoue pas tout l'historique comme s'il était neuf — cf. replay_gamelog).
#[tauri::command]
pub async fn set_gamelog_enabled(
    enabled: bool,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    if enabled {
        if let Some(path) = resolve_gamelog_path(pool).await {
            if let Ok(meta) = std::fs::metadata(&path) {
                meta_set(pool, "gamelog.offset", &meta.len().to_string()).await;
                meta_set(pool, "gamelog.path", &path.to_string_lossy()).await;
            }
        }
    }
    meta_set(pool, "gamelog.enabled", if enabled { "1" } else { "0" }).await;
    Ok(())
}

/// Rejoue l'intégralité du Game.log existant (reconstruction du carnet de bord) :
/// parse tout le fichier et persiste les événements SANS émettre de notification.
/// Renvoie le nombre d'événements reconstruits.
#[tauri::command]
pub async fn replay_gamelog(
    app: AppHandle,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(path) = resolve_gamelog_path(pool).await else {
        return Err("Installation Star Citizen introuvable (Game.log).".into());
    };
    if !path.is_file() {
        return Err(format!("Game.log introuvable : {}", path.display()));
    }
    let content = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&content);
    let account_id = active_account_id(pool).await;
    let mut count = 0i64;
    for line in text.lines() {
        if let Some(ev) = parse::parse_line(line) {
            persist_and_emit(&app, pool, &account_id, &ev, false).await;
            count += 1;
        }
    }
    // Cale l'offset sur la fin pour ne pas re-traiter ces lignes au prochain tail.
    meta_set(pool, "gamelog.offset", &(content.len() as u64).to_string()).await;
    meta_set(pool, "gamelog.path", &path.to_string_lossy()).await;
    Ok(count)
}

/// Lieu courant détecté (None si inconnu). Utilisé par le GPS de trading (Phase 1.2).
#[tauri::command]
pub async fn get_current_location(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Option<String>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    Ok(meta_get(pool, "gamelog.currentLocation").await)
}

/// N derniers événements (optionnellement filtrés par `kinds`), du plus récent au plus ancien.
#[tauri::command]
pub async fn get_recent_gamelog_events(
    limit: Option<i64>,
    kinds: Option<Vec<String>>,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let limit = limit.unwrap_or(50).clamp(1, 500);

    let rows = if let Some(kinds) = kinds.filter(|k| !k.is_empty()) {
        let placeholders = kinds.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, kind, summary, detail, occurredAt, createdAt
             FROM GameLogEvent WHERE kind IN ({placeholders})
             ORDER BY id DESC LIMIT ?"
        );
        let mut q = sqlx::query(&sql);
        for k in &kinds {
            q = q.bind(k);
        }
        q.bind(limit).fetch_all(pool).await
    } else {
        sqlx::query(
            "SELECT id, kind, summary, detail, occurredAt, createdAt
             FROM GameLogEvent ORDER BY id DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let detail = r
                .try_get::<Option<String>, _>("detail")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .unwrap_or(Value::Null);
            json!({
                "id": r.try_get::<i64, _>("id").unwrap_or(0),
                "kind": r.try_get::<String, _>("kind").unwrap_or_default(),
                "summary": r.try_get::<String, _>("summary").unwrap_or_default(),
                "detail": detail,
                "occurredAt": r.try_get::<Option<String>, _>("occurredAt").ok().flatten(),
                "createdAt": r.try_get::<Option<String>, _>("createdAt").ok().flatten(),
            })
        })
        .collect())
}
