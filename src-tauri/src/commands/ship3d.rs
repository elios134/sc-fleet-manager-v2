use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const ALLOWED: [&str; 4] = [
    "https://github.com/",
    "https://raw.githubusercontent.com/",
    "https://release-assets.githubusercontent.com/",
    "https://objects.githubusercontent.com/",
];

// sha256 hex (sert de nom de fichier de cache → doit être sûr, pas de path traversal).
fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Récupère un modèle .glb.
/// 1) Cache disque par sha256 (`<appCache>/ship3d/<sha256>.glb`) → re-clic instantané et
///    persistant entre sessions (crucial pour les intérieurs de 42-59 Mo).
/// 2) Sinon télécharge côté RUST (pas depuis le webview) → contourne le CORS : les assets
///    de GitHub Releases (`release-assets.githubusercontent.com`) n'envoient pas d'en-tête
///    `access-control-allow-origin`. reqwest suit les redirections. Hôtes restreints.
/// Renvoie les octets bruts (IPC binaire efficace).
#[tauri::command]
pub async fn get_ship_model(app: AppHandle, url: String, sha256: Option<String>) -> Result<Response, String> {
    if !ALLOWED.iter().any(|p| url.starts_with(p)) {
        return Err("URL non autorisée".into());
    }

    // Chemin de cache si un sha256 valide est fourni.
    let cache_path = match sha256.as_deref().filter(|h| is_hex(h)) {
        Some(h) => {
            let dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("ship3d");
            let _ = std::fs::create_dir_all(&dir);
            let p = dir.join(format!("{h}.glb"));
            if p.is_file() {
                let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
                return Ok(Response::new(bytes));
            }
            Some(p)
        }
        None => None,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if let Some(p) = cache_path {
        let _ = std::fs::write(&p, &bytes);
    }
    Ok(Response::new(bytes))
}
