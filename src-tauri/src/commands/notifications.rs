// Socle notifications (Lot 1) : historique en base + envoi système (gated) + event front.
// `create_notification` est la commande centrale réutilisée par les déclencheurs (Lot 4).
// L'entrée en base est TOUJOURS créée ; l'envoi OS dépend du canal « Système » (AppSettings).

use serde_json::{json, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

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

/// Compte actif (AppMeta), ou None si aucun.
async fn active_account_id(pool: &SqlitePool) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
}

/// Canal « Système » activé ? (AppSettings.notifSystem, défaut true.)
async fn notif_system_enabled(pool: &SqlitePool) -> bool {
    let row = sqlx::query("SELECT notifSystem FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r
            .try_get::<Option<i64>, _>("notifSystem")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(true),
        None => true,
    }
}

fn notif_row_json(r: &SqliteRow) -> Result<Value, String> {
    Ok(json!({
        "id": r.try_get::<i64, _>("id").map_err(|e| e.to_string())?,
        "type": r.try_get::<String, _>("type").map_err(|e| e.to_string())?,
        "title": r.try_get::<String, _>("title").map_err(|e| e.to_string())?,
        "body": r.try_get::<String, _>("body").map_err(|e| e.to_string())?,
        "relatedShipId": r.try_get::<Option<i64>, _>("relatedShipId").ok().flatten(),
        "firedAt": r.try_get::<String, _>("firedAt").map_err(|e| e.to_string())?,
        "readAt": r.try_get::<Option<String>, _>("readAt").ok().flatten(),
    }))
}

/// Insère la notif, envoie l'OS (si canal système on), émet l'event front. Renvoie l'entrée.
async fn insert_and_dispatch(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &str,
    notif_type: &str,
    title: &str,
    body: &str,
    related_ship_id: Option<i64>,
) -> Result<Value, String> {
    let res = sqlx::query(
        "INSERT INTO Notification (accountId, type, title, body, relatedShipId, firedAt, readAt)
         VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)",
    )
    .bind(account_id)
    .bind(notif_type)
    .bind(title)
    .bind(body)
    .bind(related_ship_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let id = res.last_insert_rowid();

    let row = sqlx::query(
        "SELECT id, type, title, body, relatedShipId, firedAt, readAt
         FROM Notification WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let payload = notif_row_json(&row)?;

    // Canal « Système » : envoi OS best-effort (n'échoue jamais la commande).
    if notif_system_enabled(pool).await {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    // Event front (consommé par la cloche/toast aux lots suivants).
    let _ = app.emit("notification:new", payload.clone());

    Ok(payload)
}

/// Commande centrale : crée une notif (entrée base toujours + OS gated + event).
#[tauri::command]
pub async fn create_notification(
    app: AppHandle,
    r#type: String,
    title: String,
    body: String,
    related_ship_id: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool)
        .await?
        .ok_or_else(|| "Aucun compte actif.".to_string())?;
    insert_and_dispatch(&app, pool, &account_id, &r#type, &title, &body, related_ship_id).await
}

/// Envoi de test de bout en bout (bouton « Tester » des réglages).
#[tauri::command]
pub async fn send_test_notification(
    app: AppHandle,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool)
        .await?
        .ok_or_else(|| "Aucun compte actif.".to_string())?;
    insert_and_dispatch(
        &app,
        pool,
        &account_id,
        "test",
        "SC Fleet Manager",
        "Ceci est une notification de test.",
        None,
    )
    .await
}

/// Les N dernières notifs du compte actif (firedAt desc).
#[tauri::command]
pub async fn list_notifications(
    limit: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(Value::Array(vec![]));
    };
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let rows = sqlx::query(
        "SELECT id, type, title, body, relatedShipId, firedAt, readAt
         FROM Notification WHERE accountId = ?
         ORDER BY firedAt DESC, id DESC LIMIT ?",
    )
    .bind(&account_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let out: Vec<Value> = rows
        .iter()
        .map(notif_row_json)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(out))
}

/// Nombre de non-lues du compte actif.
#[tauri::command]
pub async fn unread_count(db_instances: State<'_, DbInstances>) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(0);
    };
    let row = sqlx::query(
        "SELECT COUNT(*) AS c FROM Notification WHERE accountId = ? AND readAt IS NULL",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.try_get::<i64, _>("c").unwrap_or(0))
}

/// Marque une notif lue (scopée au compte actif).
#[tauri::command]
pub async fn mark_notification_read(
    id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(());
    };
    sqlx::query(
        "UPDATE Notification SET readAt = datetime('now')
         WHERE id = ? AND accountId = ? AND readAt IS NULL",
    )
    .bind(id)
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Marque toutes les non-lues comme lues ; renvoie le nombre affecté.
#[tauri::command]
pub async fn mark_all_read(db_instances: State<'_, DbInstances>) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(0);
    };
    let res = sqlx::query(
        "UPDATE Notification SET readAt = datetime('now')
         WHERE accountId = ? AND readAt IS NULL",
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() as i64)
}

/// Supprime une notif (scopée au compte actif).
#[tauri::command]
pub async fn delete_notification(
    id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(());
    };
    sqlx::query("DELETE FROM Notification WHERE id = ? AND accountId = ?")
        .bind(id)
        .bind(&account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/* ───────────────────────── Déclencheurs automatiques (Lot 4) ─────────────────────────
   Surveillance « app ouverte » : un check au lancement puis toutes les 30 min, dans une
   tâche tokio qui meurt avec le process (aucune tâche app fermée). Chaque déclenchement
   réutilise insert_and_dispatch (entrée base + OS gated notifSystem + event → toast gated
   notifInApp côté front), exactement comme le bouton « Tester ».

   Comparaisons temporelles : insuranceExpiry est un ISO JS (« …T…Z ») ; on le normalise
   partout via datetime(insuranceExpiry) au format SQLite UTC, directement comparable à
   firedAt (lui aussi datetime('now') UTC). Pas de parsing de date côté Rust.

   PATCH SC : NON implémenté — la V2 ne lit pas la version installée du jeu (pas de
   détection d'install / build_manifest.id ; le datamining V2 part de dumps déjà extraits).
   À reporter quand une brique de lecture de version existera. Cf. rapport.            */

const MONITOR_INTERVAL_SECS: u64 = 30 * 60; // 30 min (esprit V1)
const MONITOR_BOOT_DELAY_SECS: u64 = 8; // laisse le plugin SQL charger le pool/migrations

/// Seuil « bientôt expirée » en heures (AppSettings.insuranceExpiryThreshold, défaut 48).
async fn insurance_threshold_hours(pool: &SqlitePool) -> i64 {
    let row = sqlx::query("SELECT insuranceExpiryThreshold FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    row.and_then(|r| {
        r.try_get::<Option<i64>, _>("insuranceExpiryThreshold")
            .ok()
            .flatten()
    })
    .unwrap_or(48)
}

/// Bascule « Assurance expirée » (AppSettings.notifInsuranceExpired, défaut true).
async fn insurance_expired_enabled(pool: &SqlitePool) -> bool {
    let row = sqlx::query("SELECT notifInsuranceExpired FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r
            .try_get::<Option<i64>, _>("notifInsuranceExpired")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(true),
        None => true,
    }
}

/// « Assurance bientôt expirée » : vaisseau non-LTI dont l'assurance expire entre maintenant
/// et maintenant+seuil. Dédup : 1 notif par vaisseau et par jour (firedAt >= début du jour
/// courant pour ce vaisseau et ce type). Le seuil lui-même fait office de réglage.
async fn check_insurance_soon(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &str,
) -> Result<(), String> {
    let threshold = insurance_threshold_hours(pool).await;
    let window = format!("+{threshold} hours");

    let ships = sqlx::query(
        "SELECT id, name,
                CAST((julianday(datetime(insuranceExpiry)) - julianday('now')) * 24 AS INTEGER) AS hoursLeft
         FROM Ship
         WHERE accountId = ?
           AND COALESCE(lti, 0) = 0
           AND insuranceExpiry IS NOT NULL
           AND datetime(insuranceExpiry) > datetime('now')
           AND datetime(insuranceExpiry) <= datetime('now', ?)",
    )
    .bind(account_id)
    .bind(&window)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for ship in &ships {
        let id: i64 = ship.try_get("id").map_err(|e| e.to_string())?;
        let name: String = ship.try_get("name").map_err(|e| e.to_string())?;
        let hours_left: i64 = ship.try_get("hoursLeft").unwrap_or(0);

        // Dédup 1/vaisseau/jour (jour UTC, cohérent avec firedAt).
        let dup = sqlx::query(
            "SELECT 1 FROM Notification
             WHERE accountId = ? AND relatedShipId = ? AND type = 'insurance_soon'
               AND firedAt >= datetime('now', 'start of day') LIMIT 1",
        )
        .bind(account_id)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        if dup.is_some() {
            continue;
        }

        let title = "Assurance bientôt expirée";
        let body = format!("{name} — l'assurance expire dans {} h.", hours_left.max(0));
        insert_and_dispatch(app, pool, account_id, "insurance_soon", title, &body, Some(id)).await?;
    }
    Ok(())
}

/// « Assurance expirée » : vaisseau non-LTI dont l'assurance est déjà passée. Gated par
/// notifInsuranceExpired. Dédup par épisode : on ne re-notifie pas si une notif a déjà été
/// émise à/après cette expiration ; se ré-arme si le vaisseau est ré-assuré (nouvelle
/// expiration postérieure) puis ré-expire.
async fn check_insurance_expired(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &str,
) -> Result<(), String> {
    if !insurance_expired_enabled(pool).await {
        return Ok(());
    }

    let ships = sqlx::query(
        "SELECT id, name, insuranceExpiry FROM Ship
         WHERE accountId = ?
           AND COALESCE(lti, 0) = 0
           AND insuranceExpiry IS NOT NULL
           AND datetime(insuranceExpiry) <= datetime('now')",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    for ship in &ships {
        let id: i64 = ship.try_get("id").map_err(|e| e.to_string())?;
        let name: String = ship.try_get("name").map_err(|e| e.to_string())?;
        let expiry: String = ship.try_get("insuranceExpiry").map_err(|e| e.to_string())?;

        // Dédup par épisode : déjà notifié à/après cette expiration ?
        let dup = sqlx::query(
            "SELECT 1 FROM Notification
             WHERE accountId = ? AND relatedShipId = ? AND type = 'insurance_expired'
               AND firedAt >= datetime(?) LIMIT 1",
        )
        .bind(account_id)
        .bind(id)
        .bind(&expiry)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        if dup.is_some() {
            continue;
        }

        let title = "Assurance expirée";
        let body = format!("{name} — l'assurance a expiré.");
        insert_and_dispatch(app, pool, account_id, "insurance_expired", title, &body, Some(id))
            .await?;
    }
    Ok(())
}

/// Bascule « Nouveau patch » (AppSettings.autoPatchDetect, défaut true).
async fn auto_patch_detect_enabled(pool: &SqlitePool) -> bool {
    let row = sqlx::query("SELECT autoPatchDetect FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r
            .try_get::<Option<i64>, _>("autoPatchDetect")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(true),
        None => true,
    }
}

async fn app_meta_get(pool: &SqlitePool, key: &str) -> Option<String> {
    crate::commands::app_meta::get(pool, key).await
}

async fn app_meta_set(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    crate::commands::app_meta::set(pool, key, value).await
}

/// Déclencheur « nouveau patch SC » (au lancement uniquement — un patch sort rarement en
/// cours de session, comme V1). Gated par autoPatchDetect. Réutilise get_patch_status
/// (Lot A) + le socle insert_and_dispatch. Dédup : 1 notif par changenum (AppMeta
/// patch.notifiedChangenum) — on ne re-notifie pas tant que le changenum installé est
/// inchangé ; au prochain patch (changenum différent) → re-notif + maj de la clé.
async fn check_patch(app: &AppHandle, pool: &SqlitePool, account_id: &str) -> Result<(), String> {
    if !auto_patch_detect_enabled(pool).await {
        return Ok(());
    }

    let status_obj = super::patch_detect::compute_patch_status(pool).await;
    if status_obj.get("status").and_then(|v| v.as_str()) != Some("patch_detected") {
        return Ok(()); // up_to_date / unknown → rien
    }
    let Some(installed_cn) = status_obj.get("installedChangenum").and_then(|v| v.as_i64()) else {
        return Ok(());
    };
    let installed_version = status_obj
        .get("installedVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("—");

    // Dédup : déjà notifié pour ce changenum ?
    if let Some(prev) = app_meta_get(pool, "patch.notifiedChangenum").await {
        if prev.trim().parse::<i64>().ok() == Some(installed_cn) {
            return Ok(());
        }
    }

    let title = "Nouveau patch SC";
    let body = format!(
        "Le jeu est passé en {installed_version}. Pense à relancer le resync datamining pour mettre à jour tes données."
    );
    insert_and_dispatch(app, pool, account_id, "patch", title, &body, None).await?;

    // Mémorise le changenum notifié (dédup 1/patch).
    app_meta_set(pool, "patch.notifiedChangenum", &installed_cn.to_string()).await?;
    Ok(())
}

/// Check patch au lancement (une fois). Best-effort, mêmes garde-fous que run_triggers_once.
async fn run_patch_check_once(app: &AppHandle) {
    let Some(instances) = app.try_state::<DbInstances>() else {
        return;
    };
    let guard = instances.0.read().await;
    let pool = match guard.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return,
    };
    let Ok(Some(account_id)) = active_account_id(pool).await else {
        return;
    };
    if let Err(e) = check_patch(app, pool, &account_id).await {
        eprintln!("[monitor] patch : {e}");
    }
}

/// Un passage complet des déclencheurs sur le compte actif. Best-effort : ne panique jamais,
/// ne bloque rien (no-op si DB pas encore chargée ou aucun compte actif).
async fn run_triggers_once(app: &AppHandle) {
    let Some(instances) = app.try_state::<DbInstances>() else {
        return;
    };
    let guard = instances.0.read().await;
    let pool = match guard.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return, // DB pas encore chargée
    };
    let Ok(Some(account_id)) = active_account_id(pool).await else {
        return; // aucun compte actif → rien à surveiller
    };
    if let Err(e) = check_insurance_soon(app, pool, &account_id).await {
        eprintln!("[monitor] insurance_soon : {e}");
    }
    if let Err(e) = check_insurance_expired(app, pool, &account_id).await {
        eprintln!("[monitor] insurance_expired : {e}");
    }
}

/// Démarre la surveillance « app ouverte » : check au lancement (après un court délai pour
/// laisser la DB se charger) puis toutes les 30 min. La tâche s'arrête avec le process.
pub fn spawn_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(MONITOR_BOOT_DELAY_SECS)).await;
        // Patch : vérifié UNE FOIS au lancement (un patch sort rarement en cours de session).
        run_patch_check_once(&app).await;
        loop {
            run_triggers_once(&app).await;
            tokio::time::sleep(Duration::from_secs(MONITOR_INTERVAL_SECS)).await;
        }
    });
}

/// Purge tout l'historique du compte actif ; renvoie le nombre supprimé.
/// Ajouté au Lot 2 pour le bouton « Tout supprimer » de la cloche (plus net qu'une
/// salve de delete_notification côté front).
#[tauri::command]
pub async fn delete_all_notifications(
    db_instances: State<'_, DbInstances>,
) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(0);
    };
    let res = sqlx::query("DELETE FROM Notification WHERE accountId = ?")
        .bind(&account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() as i64)
}
