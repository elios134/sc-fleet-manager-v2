// Presets de personnage (spec docs/specs/2026-11-15-personnages-cache.md) : catalogue de
// star-citizen-characters.com (relayé ici : la CSP du front ne contacte que GitHub) et presets `.chf`
// des dossiers `user/client/0/CustomCharacters` de chaque canal installé. Inspiré de MultitoolV2.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const API: &str = "https://www.star-citizen-characters.com/api/heads";
const DNA_HOST: &str = "images.star-citizen-characters.com";
const CHANNELS: [&str; 5] = ["LIVE", "PTU", "EPTU", "TECH-PREVIEW", "HOTFIX"];

/// Titre → nom de fichier sûr sous Windows.
pub(crate) fn sanitize_file_name(title: &str) -> String {
    let s: String = title.trim().chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim_matches(['.', ' ']).to_string();
    if s.is_empty() { "preset".into() } else { s.chars().take(80).collect() }
}

/// Seul un `.chf` en https sur le domaine d'images du site peut être téléchargé.
pub(crate) fn is_allowed_dna_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    u.scheme() == "https" && u.host_str() == Some(DNA_HOST) && u.path().to_lowercase().ends_with(".chf")
}

/// Ligne de l'API → contrat du front.
pub(crate) fn catalog_row(r: &Value) -> Option<Value> {
    let s = |p: &str| r.pointer(p).and_then(|v| v.as_str()).map(str::to_string);
    Some(json!({
        "id": s("/id")?,
        "title": s("/title").unwrap_or_default().trim(),
        "author": s("/user/name"),
        "createdAt": s("/createdAt"),
        "previewUrl": s("/previewUrl"),
        "dnaUrl": s("/dnaUrl")?,
        "downloads": r.pointer("/_count/characterDownloads").and_then(|v| v.as_i64()).unwrap_or(0),
        "likes": r.pointer("/_count/characterLikes").and_then(|v| v.as_i64()).unwrap_or(0),
    }))
}

/// Canaux installés : (canal, dossier) frères de l'installation résolue.
async fn installs(db: &State<'_, DbInstances>) -> Vec<(String, PathBuf)> {
    let lock = db.0.read().await;
    let configured = match lock.get(DB_URL) {
        Some(DbPool::Sqlite(pool)) => crate::commands::app_meta::get(pool, crate::commands::sc_install::SC_INSTALL_KEY).await,
        _ => None,
    };
    let Some((install, channel)) = crate::commands::patch_detect::resolve_sc_install(configured) else {
        return Vec::new();
    };
    let main = PathBuf::from(&install);
    let mut out = vec![(channel.clone(), main.clone())];
    if let Some(root) = main.parent() {
        for ch in CHANNELS.iter().filter(|c| **c != channel) {
            let p = root.join(ch);
            if crate::commands::patch_detect::is_valid_install(&p.to_string_lossy()) {
                out.push((ch.to_string(), p));
            }
        }
    }
    out
}

fn characters_dir(install: &Path) -> PathBuf {
    install.join("user").join("client").join("0").join("CustomCharacters")
}

#[tauri::command]
pub async fn characters_catalog(page: u32, order: String, search: String) -> Result<Value, String> {
    let order = if order == "download" { "download" } else { "latest" };
    let mut url = reqwest::Url::parse(API).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("page", &page.max(1).to_string()).append_pair("orderBy", order);
    if !search.trim().is_empty() {
        url.query_pairs_mut().append_pair("search", search.trim());
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("SCFleetManager/3").build().map_err(|e| e.to_string())?;
    let body: Value = client.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let b = body.get("body").unwrap_or(&body);
    let rows: Vec<Value> = b.get("rows").and_then(|v| v.as_array()).into_iter().flatten().filter_map(catalog_row).collect();
    Ok(json!({ "rows": rows, "hasNextPage": b.get("hasNextPage").and_then(|v| v.as_bool()).unwrap_or(false) }))
}

/// Presets `.chf` de chaque canal installé.
#[tauri::command]
pub async fn characters_local(db: State<'_, DbInstances>) -> Result<Value, String> {
    let targets = installs(&db).await;
    let channels: Vec<String> = targets.iter().map(|(c, _)| c.clone()).collect();
    let mut out = Vec::new();
    for (channel, install) in targets {
        let Ok(rd) = std::fs::read_dir(characters_dir(&install)) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if !p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("chf")) {
                continue;
            }
            let modified = e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());
            out.push(json!({
                "name": p.file_stem().map(|s| s.to_string_lossy().to_string()),
                "path": p.to_string_lossy(),
                "channel": channel,
                "modifiedAt": modified,
            }));
        }
    }
    Ok(json!({ "characters": out, "gameFound": !channels.is_empty(), "channels": channels }))
}

/// Télécharge un preset et l'écrit dans chaque canal installé. Renvoie les canaux servis.
#[tauri::command]
pub async fn characters_install(db: State<'_, DbInstances>, dna_url: String, title: String) -> Result<Vec<String>, String> {
    if !is_allowed_dna_url(&dna_url) {
        return Err("Adresse de preset refusée.".into());
    }
    let targets = installs(&db).await;
    if targets.is_empty() {
        return Err("Star Citizen introuvable (Réglages › Jeu).".into());
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).user_agent("SCFleetManager/3").build().map_err(|e| e.to_string())?;
    let bytes = client.get(&dna_url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > 1_000_000 {
        return Err("Fichier de preset invalide.".into());
    }
    let file = format!("{}.chf", sanitize_file_name(&title));
    let mut done = Vec::new();
    for (channel, install) in targets {
        let dir = characters_dir(&install);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(&file), &bytes).map_err(|e| e.to_string())?;
        done.push(channel);
    }
    Ok(done)
}

/// Un chemin de preset n'est accepté que s'il est un `.chf` d'un dossier CustomCharacters installé.
async fn checked_preset(db: &State<'_, DbInstances>, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let ok_ext = p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("chf"));
    let parent = p.parent().and_then(|d| d.canonicalize().ok());
    let allowed = installs(db).await.iter().filter_map(|(_, i)| characters_dir(i).canonicalize().ok()).any(|d| Some(&d) == parent.as_ref());
    if ok_ext && allowed && p.is_file() { Ok(p) } else { Err("Preset introuvable.".into()) }
}

#[tauri::command]
pub async fn characters_delete(db: State<'_, DbInstances>, path: String) -> Result<(), String> {
    let p = checked_preset(&db, &path).await?;
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

/// Copie un preset vers les autres canaux installés. Renvoie les canaux servis.
#[tauri::command]
pub async fn characters_copy(db: State<'_, DbInstances>, path: String) -> Result<Vec<String>, String> {
    let src = checked_preset(&db, &path).await?;
    let name = src.file_name().ok_or("Nom invalide")?.to_owned();
    let mut done = Vec::new();
    for (channel, install) in installs(&db).await {
        let dir = characters_dir(&install);
        if dir.join(&name) == src {
            continue;
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::copy(&src, dir.join(&name)).map_err(|e| e.to_string())?;
        done.push(channel);
    }
    Ok(done)
}

#[tauri::command]
pub async fn characters_open_folder(app: AppHandle, db: State<'_, DbInstances>) -> Result<(), String> {
    let (_, install) = installs(&db).await.into_iter().next().ok_or("Star Citizen introuvable (Réglages › Jeu).")?;
    let dir = characters_dir(&install);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_de_fichier_surs() {
        assert_eq!(sanitize_file_name("John Wick"), "John Wick");
        assert_eq!(sanitize_file_name("a/b:c*?"), "a_b_c__");
        assert_eq!(sanitize_file_name("  ..  "), "preset");
        assert_eq!(sanitize_file_name("..\\..\\x"), "_.._x");
    }

    #[test]
    fn seules_les_adresses_du_site() {
        assert!(is_allowed_dna_url("https://images.star-citizen-characters.com/images/characters/c739/maxblazar.chf"));
        assert!(!is_allowed_dna_url("http://images.star-citizen-characters.com/x.chf"));
        assert!(!is_allowed_dna_url("https://evil.example/x.chf"));
        assert!(!is_allowed_dna_url("https://images.star-citizen-characters.com/x.exe"));
        assert!(!is_allowed_dna_url("pas une url"));
    }

    #[test]
    fn ligne_du_catalogue() {
        let r = serde_json::json!({ "id": "c7", "title": " Ember ", "user": { "name": "RedsResort" }, "previewUrl": "p.jpeg", "dnaUrl": "d.chf", "_count": { "characterDownloads": 561, "characterLikes": 129 } });
        let v = catalog_row(&r).unwrap();
        assert_eq!(v["title"], "Ember");
        assert_eq!(v["author"], "RedsResort");
        assert_eq!(v["downloads"], 561);
        assert!(catalog_row(&serde_json::json!({ "id": "x" })).is_none());
    }
}
