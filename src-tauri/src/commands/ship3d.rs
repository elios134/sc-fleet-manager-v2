use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

const ALLOWED: [&str; 4] = [
    "https://github.com/",
    "https://raw.githubusercontent.com/",
    "https://release-assets.githubusercontent.com/",
    "https://objects.githubusercontent.com/",
];

/// DÉVELOPPEMENT UNIQUEMENT (build debug) : dossier du dépôt asset-3D voisin (`../asset-3D`), ou
/// `SHIP3D_DEV_DIR`. Permet de voir dans `npm run tauri dev` des modèles construits localement, sans
/// les publier. Absent des builds de production (`cfg(debug_assertions)`).
#[cfg(debug_assertions)]
fn dev_asset_dir() -> Option<std::path::PathBuf> {
    let dir = std::env::var_os("SHIP3D_DEV_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../asset-3D"));
    dir.is_dir().then_some(dir)
}

/// Nom de fichier sûr (pas de chemin) pour la lecture locale de dev.
#[cfg(debug_assertions)]
fn safe_file_name(url: &str) -> Option<&str> {
    let name = url.rsplit('/').next()?;
    (!name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))).then_some(name)
}

/// Index de dev (`asset-3D/index.dev.json`, écrit par `publish.mjs --dev-index`) ; None en production
/// ou s'il n'existe pas → l'app lit l'index publié.
#[tauri::command]
pub fn ship3d_dev_index() -> Option<String> {
    #[cfg(debug_assertions)]
    let index = dev_asset_dir().and_then(|d| std::fs::read_to_string(d.join("index.dev.json")).ok());
    #[cfg(not(debug_assertions))]
    let index = None;
    index
}

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
    // Dev : modèle construit localement dans asset-3D/models (même nom de fichier) → lu sans téléchargement.
    #[cfg(debug_assertions)]
    if let Some(p) = dev_asset_dir().zip(safe_file_name(&url)).map(|(d, n)| d.join("models").join(n)) {
        if p.is_file() {
            return std::fs::read(&p).map(Response::new).map_err(|e| e.to_string());
        }
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
