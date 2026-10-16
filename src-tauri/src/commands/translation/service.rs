// Commandes Tauri de la page Traduction + logique partagée avec le service de fond.
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::commands::gamelog::{meta_get, meta_set};
use crate::commands::patch_detect::is_valid_install;
use crate::commands::translation::{cfg, feed, fsops, ini, registry};
use crate::commands::translation::feed::Pack;
use crate::commands::translation::registry::InstallRow;
use crate::DB_URL;

const FEED_URL: &str = "https://cdn.jsdelivr.net/gh/elios134/sc-fleet-trad-feed@main/translations.json";
const K_AUTO: &str = "trad.autoUpdate";
const FEED_TIMEOUT: u64 = 15;
const PACK_TIMEOUT: u64 = 90; // un global.ini pèse ~12 Mo

macro_rules! pool_of {
    ($g:expr) => {{
        match $g.get(DB_URL) {
            Some(DbPool::Sqlite(p)) => p,
            #[allow(unreachable_patterns)]
            _ => return Err(format!("DB non chargée : {DB_URL}")),
        }
    }};
}

/* ───────────────────────────── Logique pure ───────────────────────────── */

/// Vrai si `g_language` désigne déjà une AUTRE langue et que le joueur n'a pas confirmé.
pub fn decide_conflict(current: Option<&str>, folder: &str, force: bool) -> bool {
    !force && current.is_some_and(|c| !c.eq_ignore_ascii_case(folder))
}

/* ───────────────────────────── Verrou par canal ───────────────────────────── */

fn busy() -> &'static Mutex<HashSet<String>> {
    static BUSY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    BUSY.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Une seule opération d'install/maj/désinstall à la fois par canal (libéré au Drop).
struct ChannelLock(String);

impl ChannelLock {
    fn take(path: &str) -> Result<Self, String> {
        let mut set = busy().lock().map_err(|_| "verrou indisponible".to_string())?;
        if !set.insert(path.to_string()) {
            return Err("Opération déjà en cours sur ce canal".into());
        }
        Ok(Self(path.to_string()))
    }
}

impl Drop for ChannelLock {
    fn drop(&mut self) {
        if let Ok(mut set) = busy().lock() {
            set.remove(&self.0);
        }
    }
}

/* ───────────────────────────── Réseau ───────────────────────────── */

enum Fetched {
    NotModified,
    Body { text: String, etag: Option<String>, last_modified: Option<String> },
}

/// GET (conditionnel si validateurs connus) : 304 → NotModified.
async fn fetch(url: &str, secs: u64, etag: Option<&str>, last_modified: Option<&str>) -> Result<Fetched, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(secs))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url).header("User-Agent", "SCFleetManager");
    if let Some(e) = etag {
        req = req.header("If-None-Match", e);
    }
    if let Some(lm) = last_modified {
        req = req.header("If-Modified-Since", lm);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(Fetched::NotModified);
    }
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let header = |k: &str| resp.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (etag, last_modified) = (header("etag"), header("last-modified"));
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(Fetched::Body { text, etag, last_modified })
}

/// Télécharge un pack et vérifie sa plausibilité (rien n'est écrit sinon).
async fn download_pack(url: &str) -> Result<(String, Option<String>, Option<String>), String> {
    match fetch(url, PACK_TIMEOUT, None, None).await? {
        Fetched::Body { text, etag, last_modified } if ini::is_plausible(&text) => Ok((text, etag, last_modified)),
        Fetched::Body { .. } => Err("Le fichier reçu n'est pas une traduction valide (vide ou page web).".into()),
        Fetched::NotModified => Err("Réponse inattendue du serveur (304).".into()),
    }
}

/* ───────────────────────────── Canaux ───────────────────────────── */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    path: String,
    label: String,
    manual: bool,
    install: Option<InstallRow>,
    current_language: Option<String>,
}

fn label_of(p: &Path) -> String {
    p.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string()
}

async fn channels(pool: &SqlitePool) -> Vec<ChannelInfo> {
    let mut found: Vec<(String, PathBuf, bool)> = match registry::install_root(pool).await {
        Some(root) => fsops::list_channels(&root).into_iter().map(|(l, p)| (l, p, false)).collect(),
        None => Vec::new(),
    };
    for m in registry::manual_channels(pool).await {
        let p = PathBuf::from(&m);
        if is_valid_install(&m) && !found.iter().any(|(_, fp, _)| fp == &p) {
            found.push((label_of(&p), p, true));
        }
    }
    let mut out = Vec::with_capacity(found.len());
    for (label, p, manual) in found {
        let path = p.to_string_lossy().to_string();
        out.push(ChannelInfo {
            install: registry::get(pool, &path).await,
            current_language: cfg::current_language(&fsops::read_cfg(&p)),
            path,
            label,
            manual,
        });
    }
    out
}

/* ───────────────────────── Vérif / maj (partagées avec le fond) ───────────────────────── */

/// Contrôle « à jour ? » de toutes les installs (requête conditionnelle, repli contenu).
pub(crate) async fn check_all(pool: &SqlitePool) {
    for r in registry::list(pool).await {
        let res = fetch(&r.url, PACK_TIMEOUT, r.etag.as_deref(), r.last_modified.as_deref()).await;
        match res {
            Ok(Fetched::NotModified) => {
                registry::set_check(pool, &r.channel_path, r.etag.as_deref(), r.last_modified.as_deref(), r.update_available).await
            }
            Ok(Fetched::Body { text, etag, last_modified }) => {
                let local = fsops::read_global_ini(Path::new(&r.channel_path), &r.folder).unwrap_or_default();
                let changed = ini::is_plausible(&text) && !ini::same_content(&local, &text);
                registry::set_check(pool, &r.channel_path, etag.as_deref(), last_modified.as_deref(), changed).await
            }
            Err(_) => {} // hors-ligne / hôte KO : état inchangé
        }
    }
}

/// Maj d'un canal : réécrit UNIQUEMENT le global.ini (jamais le user.cfg).
pub(crate) async fn update_one(pool: &SqlitePool, channel_path: &str) -> Result<(), String> {
    let _lock = ChannelLock::take(channel_path)?;
    let r = registry::get(pool, channel_path).await.ok_or("Aucune traduction installée sur ce canal")?;
    let (text, etag, lm) = download_pack(&r.url).await?;
    fsops::write_global_ini(Path::new(channel_path), &r.folder, &text).map_err(|e| e.to_string())?;
    registry::set_check(pool, channel_path, etag.as_deref(), lm.as_deref(), false).await;
    Ok(())
}

/* ───────────────────────────── Commandes ───────────────────────────── */

fn feed_cache(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("trad-feed.json"))
}

/// Vitrine : feed réseau (→ cache) sinon cache, sinon vide ; + sources perso.
#[tauri::command]
pub async fn translation_feed(app: AppHandle, db: tauri::State<'_, DbInstances>) -> Result<Vec<Pack>, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let cache = feed_cache(&app);
    let from_cache = || cache.as_deref().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| feed::parse_feed(&s).ok());
    let packs = match fetch(FEED_URL, FEED_TIMEOUT, None, None).await {
        Ok(Fetched::Body { text, .. }) => match feed::parse_feed(&text) {
            Ok(p) => {
                if let Some(c) = &cache {
                    let _ = std::fs::write(c, &text);
                }
                p
            }
            Err(_) => from_cache().unwrap_or_default(),
        },
        _ => from_cache().unwrap_or_default(),
    };
    Ok(feed::merge_packs(packs, registry::custom_sources(pool).await))
}

#[tauri::command]
pub async fn translation_channels(db: tauri::State<'_, DbInstances>) -> Result<Vec<ChannelInfo>, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    Ok(channels(pool).await)
}

#[tauri::command]
pub async fn translation_add_channel(db: tauri::State<'_, DbInstances>, path: String) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let path = path.trim().trim_end_matches(['\\', '/']).to_string();
    if !is_valid_install(&path) {
        return Err("Dossier invalide : il doit contenir Data.p4k (ex. …\\StarCitizen\\LIVE).".into());
    }
    let mut list = registry::manual_channels(pool).await;
    if !list.contains(&path) {
        list.push(path);
        registry::set_manual_channels(pool, &list).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn translation_remove_channel(db: tauri::State<'_, DbInstances>, path: String) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let list: Vec<String> = registry::manual_channels(pool).await.into_iter().filter(|p| p != &path).collect();
    registry::set_manual_channels(pool, &list).await;
    Ok(())
}

#[tauri::command]
pub async fn translation_add_source(db: tauri::State<'_, DbInstances>, name: String, url: String) -> Result<Pack, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let url = feed::normalize_source_url(&url)?;
    download_pack(&url).await?;
    let name = if name.trim().is_empty() { "Source perso".to_string() } else { name.trim().to_string() };
    let pack = feed::custom_pack(&name, &url);
    let mut list = registry::custom_sources(pool).await;
    list.retain(|p| p.url != url);
    list.push(pack.clone());
    registry::set_custom_sources(pool, &list).await;
    Ok(pack)
}

#[tauri::command]
pub async fn translation_remove_source(db: tauri::State<'_, DbInstances>, id: String) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let list: Vec<Pack> = registry::custom_sources(pool).await.into_iter().filter(|p| p.id != id).collect();
    registry::set_custom_sources(pool, &list).await;
    Ok(())
}

#[tauri::command]
pub async fn translation_preview(url: String) -> Result<Vec<(String, String)>, String> {
    let (text, _, _) = download_pack(&url).await?;
    Ok(ini::preview(&text))
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallOutcome {
    Installed,
    Conflict { current: String },
}

#[tauri::command]
pub async fn translation_install(
    db: tauri::State<'_, DbInstances>,
    channel_path: String,
    pack_id: String,
    folder: String,
    url: String,
    force: bool,
) -> Result<InstallOutcome, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let _lock = ChannelLock::take(&channel_path)?;
    let ch = PathBuf::from(&channel_path);
    if !is_valid_install(&channel_path) {
        return Err("Canal Star Citizen introuvable.".into());
    }
    let current = cfg::current_language(&fsops::read_cfg(&ch));
    if decide_conflict(current.as_deref(), &folder, force) {
        return Ok(InstallOutcome::Conflict { current: current.unwrap_or_default() });
    }
    let (text, etag, last_modified) = download_pack(&url).await?;
    fsops::write_global_ini(&ch, &folder, &text).map_err(|e| format!("Écriture global.ini : {e}"))?;
    fsops::apply_cfg(&ch, |c| cfg::merge_language(c, &folder)).map_err(|e| format!("Écriture user.cfg : {e}"))?;
    // Pack précédent d'un autre dossier sur ce canal : on retire son dossier (c'était le nôtre).
    if let Some(prev) = registry::get(pool, &channel_path).await {
        if !prev.folder.eq_ignore_ascii_case(&folder) {
            let _ = fsops::remove_localization(&ch, &prev.folder);
        }
    }
    registry::upsert(
        pool,
        &InstallRow {
            channel_path,
            pack_id,
            folder,
            url,
            etag,
            last_modified,
            update_available: false,
            installed_at: String::new(),
            checked_at: None,
        },
    )
    .await?;
    Ok(InstallOutcome::Installed)
}

#[tauri::command]
pub async fn translation_update(db: tauri::State<'_, DbInstances>, channel_path: String) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    update_one(pool, &channel_path).await
}

#[tauri::command]
pub async fn translation_uninstall(db: tauri::State<'_, DbInstances>, channel_path: String) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let _lock = ChannelLock::take(&channel_path)?;
    let r = registry::get(pool, &channel_path).await.ok_or("Aucune traduction installée sur ce canal")?;
    let ch = PathBuf::from(&channel_path);
    fsops::remove_localization(&ch, &r.folder).map_err(|e| e.to_string())?;
    // On ne retire g_language que s'il désigne encore NOTRE dossier.
    let ours = cfg::current_language(&fsops::read_cfg(&ch)).is_some_and(|c| c.eq_ignore_ascii_case(&r.folder));
    if ours {
        fsops::apply_cfg(&ch, cfg::strip_language).map_err(|e| e.to_string())?;
    }
    registry::delete(pool, &channel_path).await
}

#[tauri::command]
pub async fn translation_check_updates(db: tauri::State<'_, DbInstances>) -> Result<Vec<ChannelInfo>, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    check_all(pool).await;
    Ok(channels(pool).await)
}

#[tauri::command]
pub async fn translation_auto_get(db: tauri::State<'_, DbInstances>) -> Result<bool, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    Ok(meta_get(pool, K_AUTO).await.as_deref() == Some("1"))
}

#[tauri::command]
pub async fn translation_auto_set(db: tauri::State<'_, DbInstances>, enabled: bool) -> Result<(), String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    meta_set(pool, K_AUTO, if enabled { "1" } else { "0" }).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FR: &str = "french_(france)";

    #[test]
    fn pas_de_conflit_si_absent() {
        assert!(!decide_conflict(None, FR, false));
    }

    #[test]
    fn pas_de_conflit_si_meme_folder() {
        assert!(!decide_conflict(Some("French_(France)"), FR, false));
    }

    #[test]
    fn conflit_si_autre_langue() {
        assert!(decide_conflict(Some("german_(germany)"), FR, false));
    }

    #[test]
    fn force_annule_conflit() {
        assert!(!decide_conflict(Some("german_(germany)"), FR, true));
    }
}
