// Registre persistant (lu aussi par le service de fond) : installs par canal en table,
// sources perso + chemins manuels en JSON dans AppMeta. SQL toujours paramétré.
use serde::Serialize;
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::path::PathBuf;

use crate::commands::gamelog::{meta_get, meta_set};
use crate::commands::patch_detect::resolve_sc_install;
use crate::commands::translation::feed::Pack;

const K_SOURCES: &str = "trad.customSources";
const K_CHANNELS: &str = "trad.manualChannels";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallRow {
    pub channel_path: String,
    pub pack_id: String,
    pub folder: String,
    pub url: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub update_available: bool,
    pub installed_at: String,
    pub checked_at: Option<String>,
}

const COLS: &str = "channelPath, packId, folder, url, etag, lastModified, updateAvailable, installedAt, checkedAt";

fn row(r: &SqliteRow) -> Option<InstallRow> {
    Some(InstallRow {
        channel_path: r.try_get("channelPath").ok()?,
        pack_id: r.try_get("packId").ok()?,
        folder: r.try_get("folder").ok()?,
        url: r.try_get("url").ok()?,
        etag: r.try_get("etag").ok().flatten(),
        last_modified: r.try_get("lastModified").ok().flatten(),
        update_available: r.try_get::<i64, _>("updateAvailable").ok()? != 0,
        installed_at: r.try_get("installedAt").ok()?,
        checked_at: r.try_get("checkedAt").ok().flatten(),
    })
}

pub async fn get(pool: &SqlitePool, channel_path: &str) -> Option<InstallRow> {
    let sql = format!("SELECT {COLS} FROM TranslationInstall WHERE channelPath = ?");
    let r = sqlx::query(&sql).bind(channel_path).fetch_optional(pool).await.ok()??;
    row(&r)
}

pub async fn list(pool: &SqlitePool) -> Vec<InstallRow> {
    let sql = format!("SELECT {COLS} FROM TranslationInstall");
    sqlx::query(&sql).fetch_all(pool).await.unwrap_or_default().iter().filter_map(row).collect()
}

/// Nouvelle install (ou remplacement du pack du canal) : remet l'état de vérif à zéro.
pub async fn upsert(pool: &SqlitePool, r: &InstallRow) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO TranslationInstall (channelPath, packId, folder, url, etag, lastModified, updateAvailable, installedAt, checkedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
         ON CONFLICT(channelPath) DO UPDATE SET packId = excluded.packId, folder = excluded.folder,
           url = excluded.url, etag = excluded.etag, lastModified = excluded.lastModified,
           updateAvailable = 0, installedAt = excluded.installedAt, checkedAt = excluded.checkedAt",
    )
    .bind(&r.channel_path)
    .bind(&r.pack_id)
    .bind(&r.folder)
    .bind(&r.url)
    .bind(&r.etag)
    .bind(&r.last_modified)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub async fn delete(pool: &SqlitePool, channel_path: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM TranslationInstall WHERE channelPath = ?")
        .bind(channel_path)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Résultat d'une vérification « à jour ? » (validateurs HTTP + drapeau).
pub async fn set_check(
    pool: &SqlitePool,
    channel_path: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
    update_available: bool,
) {
    let _ = sqlx::query(
        "UPDATE TranslationInstall SET etag = ?, lastModified = ?, updateAvailable = ?, checkedAt = datetime('now')
         WHERE channelPath = ?",
    )
    .bind(etag)
    .bind(last_modified)
    .bind(update_available as i64)
    .bind(channel_path)
    .execute(pool)
    .await;
}

async fn json_get<T: serde::de::DeserializeOwned + Default>(pool: &SqlitePool, key: &str) -> T {
    meta_get(pool, key).await.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

async fn json_set<T: Serialize>(pool: &SqlitePool, key: &str, v: &T) {
    if let Ok(s) = serde_json::to_string(v) {
        meta_set(pool, key, &s).await;
    }
}

pub async fn manual_channels(pool: &SqlitePool) -> Vec<String> {
    json_get(pool, K_CHANNELS).await
}

pub async fn set_manual_channels(pool: &SqlitePool, v: &[String]) {
    json_set(pool, K_CHANNELS, &v).await
}

pub async fn custom_sources(pool: &SqlitePool) -> Vec<Pack> {
    json_get(pool, K_SOURCES).await
}

pub async fn set_custom_sources(pool: &SqlitePool, v: &[Pack]) {
    json_set(pool, K_SOURCES, &v).await
}

/// Racine de l'install SC (dossier parent du canal résolu, ex. …/StarCitizen).
pub async fn install_root(pool: &SqlitePool) -> Option<PathBuf> {
    let configured = meta_get(pool, "datamining.scInstallPath").await;
    let (install, _) = resolve_sc_install(configured)?;
    PathBuf::from(install).parent().map(PathBuf::from)
}
