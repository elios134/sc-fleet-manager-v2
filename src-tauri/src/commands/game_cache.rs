// Cache du jeu (spec docs/specs/2026-11-15-personnages-cache.md) : dossiers de
// `%LOCALAPPDATA%\Star Citizen` (shaders par version, rapports de plantage), avec ce qui est sans
// risque à supprimer. Suppression refusée tant que StarCitizen.exe tourne. Inspiré de MultitoolV2.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

fn cache_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Star Citizen"))
}

/// « 4.10.200.58746 » (build_manifest) → « 4.10.2 » ; « 4.10.0 » reste tel quel.
pub(crate) fn short_version(v: &str) -> Option<String> {
    let mut it = v.split('.').map(|p| p.trim().parse::<u32>());
    let (Some(Ok(a)), Some(Ok(b)), Some(Ok(c))) = (it.next(), it.next(), it.next()) else { return None };
    Some(format!("{a}.{b}.{}", if c >= 100 { c / 100 } else { c }))
}

/// Version d'un dossier de shaders : « starcitizen_(sc-alpha-4.10.2)_ifbkwb_0 » → « 4.10.2 ».
pub(crate) fn folder_version(name: &str) -> Option<String> {
    let start = name.find("-alpha-").map(|i| i + 7).or_else(|| name.find('(').map(|i| i + 1))?;
    let rest = &name[start..];
    let end = rest.find([')', '_']).unwrap_or(rest.len());
    let v = &rest[..end];
    (v.split('.').count() == 3 && v.split('.').all(|p| p.parse::<u32>().is_ok())).then(|| v.to_string())
}

/// Nature d'un dossier : `shaders_old` / `shaders_current` (sans risque si ancien), `crashes`, `other`.
pub(crate) fn classify(name: &str, installed: Option<&str>) -> &'static str {
    if name.eq_ignore_ascii_case("crashes") {
        return "crashes";
    }
    match (folder_version(name), installed) {
        (Some(v), Some(i)) if v == i => "shaders_current",
        (Some(_), Some(_)) => "shaders_old",
        (Some(_), None) => "shaders_current",
        _ => "other",
    }
}

/// Nom d'un enfant direct du dossier de cache (aucun séparateur ni remontée).
pub(crate) fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .map(|rd| {
            rd.flatten()
                .map(|e| match e.file_type() {
                    Ok(t) if t.is_dir() => dir_size(&e.path()),
                    Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

/// StarCitizen.exe en cours d'exécution (Windows : tasklist).
fn game_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq StarCitizen.exe", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("starcitizen.exe"))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

async fn installed_version(db: &State<'_, DbInstances>) -> Option<String> {
    let lock = db.0.read().await;
    let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) else { return None };
    let status = crate::commands::patch_detect::compute_patch_status(pool).await;
    status.get("installedVersion").and_then(|v| v.as_str()).and_then(short_version)
}

#[tauri::command]
pub async fn game_cache_info(db: State<'_, DbInstances>) -> Result<Value, String> {
    let installed = installed_version(&db).await;
    let root = cache_root().ok_or("Dossier LOCALAPPDATA introuvable.")?;
    let folders = tokio::task::spawn_blocking({
        let root = root.clone();
        let installed = installed.clone();
        move || -> Vec<Value> {
            let Ok(rd) = std::fs::read_dir(&root) else { return Vec::new() };
            let mut v: Vec<Value> = rd
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let files = std::fs::read_dir(e.path()).map(|r| r.count()).unwrap_or(0);
                    json!({
                        "kind": classify(&name, installed.as_deref()),
                        "version": folder_version(&name),
                        "bytes": dir_size(&e.path()),
                        "files": files,
                        "name": name,
                    })
                })
                .collect();
            v.sort_by_key(|f| std::cmp::Reverse(f["bytes"].as_u64().unwrap_or(0)));
            v
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "root": root.to_string_lossy(),
        "exists": root.is_dir(),
        "installedVersion": installed,
        "gameRunning": game_running(),
        "folders": folders,
    }))
}

/// Supprime les dossiers nommés (enfants directs du cache). Renvoie les octets libérés.
#[tauri::command]
pub async fn game_cache_delete(names: Vec<String>) -> Result<u64, String> {
    if game_running() {
        return Err("Ferme Star Citizen avant de vider le cache.".into());
    }
    let root = cache_root().ok_or("Dossier LOCALAPPDATA introuvable.")?;
    tokio::task::spawn_blocking(move || {
        let mut freed = 0u64;
        for n in names.iter().filter(|n| is_plain_name(n)) {
            let p = root.join(n);
            if p.is_dir() {
                let size = dir_size(&p);
                std::fs::remove_dir_all(&p).map_err(|e| format!("{n} : {e}"))?;
                freed += size;
            }
        }
        Ok(freed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn game_cache_open(app: AppHandle) -> Result<(), String> {
    let root = cache_root().filter(|r| r.is_dir()).ok_or("Aucun cache de Star Citizen.")?;
    app.opener().open_path(root.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(short_version("4.10.200.58746").as_deref(), Some("4.10.2"));
        assert_eq!(short_version("4.10.0.1234").as_deref(), Some("4.10.0"));
        assert_eq!(short_version("x"), None);
        assert_eq!(folder_version("starcitizen_(sc-alpha-4.10.2)_ifbkwb_0").as_deref(), Some("4.10.2"));
        assert_eq!(folder_version("crashes"), None);
    }

    #[test]
    fn nature_des_dossiers() {
        assert_eq!(classify("starcitizen_(sc-alpha-4.10.0)_ifbkwb_0", Some("4.10.2")), "shaders_old");
        assert_eq!(classify("starcitizen_(sc-alpha-4.10.2)_ifbkwb_0", Some("4.10.2")), "shaders_current");
        assert_eq!(classify("starcitizen_(sc-alpha-4.10.2)_ifbkwb_0", None), "shaders_current");
        assert_eq!(classify("crashes", Some("4.10.2")), "crashes");
        assert_eq!(classify("autre", Some("4.10.2")), "other");
    }

    #[test]
    fn noms_surs() {
        assert!(is_plain_name("crashes"));
        assert!(!is_plain_name(".."));
        assert!(!is_plain_name("a\\b"));
        assert!(!is_plain_name("C:"));
        assert!(!is_plain_name(""));
    }
}
