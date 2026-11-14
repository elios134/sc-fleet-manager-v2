// Chemin d'installation de Star Citizen (Réglages › Jeu) : validation d'un dossier, choix manuel
// persisté en AppMeta, chemin effectivement résolu (manuel prioritaire, sinon auto-détection).
// Lu par le Game.log, la traduction, la détection de patch et les noms FR des plans.
use serde_json::{json, Value};
use std::path::Path;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

/// Clé AppMeta du chemin choisi à la main. Nom historique conservé : la valeur est déjà en base.
pub(crate) const SC_INSTALL_KEY: &str = "datamining.scInstallPath";

/// Un dossier de canal valide contient Data.p4k ; Game.log (ou un logbackups/*.log) prouve
/// que le jeu y a déjà tourné.
pub(crate) fn validate_path_fs(path: &str) -> (bool, bool) {
    let p = Path::new(path);
    (p.join("Data.p4k").is_file(), p.join("Game.log").is_file() || logbackups_has_log(p))
}

fn logbackups_has_log(install: &Path) -> bool {
    std::fs::read_dir(install.join("logbackups"))
        .map(|rd| {
            rd.flatten().any(|e| {
                e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("log"))
            })
        })
        .unwrap_or(false)
}

/// Pool SQLite de l'appli (erreur lisible si la base n'est pas encore chargée).
macro_rules! pool {
    ($lock:expr) => {
        match $lock.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            _ => return Err(format!("Base de données non chargée : {DB_URL}")),
        }
    };
}

/// { hasDataP4k, hasGameLog } pour un dossier.
#[tauri::command]
pub async fn validate_sc_path(path: String) -> Result<Value, String> {
    let (p4k, log) = validate_path_fs(&path);
    Ok(json!({ "hasDataP4k": p4k, "hasGameLog": log }))
}

/// Définit le chemin manuel ; chaîne vide = retour à l'auto-détection. Refusé sans Data.p4k.
#[tauri::command]
pub async fn set_sc_install_path(db: State<'_, DbInstances>, path: String) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if !trimmed.is_empty() && !validate_path_fs(&trimmed).0 {
        return Err(format!("Data.p4k introuvable dans : {trimmed}"));
    }
    let lock = db.0.read().await;
    let pool = pool!(lock);
    if trimmed.is_empty() {
        sqlx::query("DELETE FROM AppMeta WHERE key = ?")
            .bind(SC_INSTALL_KEY)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        crate::commands::app_meta::set(pool, SC_INSTALL_KEY, &trimmed).await
    }
}

/// { configured, resolved, channel } : chemin manuel et chemin/canal réellement utilisés.
#[tauri::command]
pub async fn get_sc_install_path(db: State<'_, DbInstances>) -> Result<Value, String> {
    let lock = db.0.read().await;
    let configured = crate::commands::app_meta::get(pool!(lock), SC_INSTALL_KEY).await.filter(|s| !s.trim().is_empty());
    let resolved = crate::commands::patch_detect::resolve_sc_install(configured.clone());
    Ok(json!({
        "configured": configured,
        "resolved": resolved.as_ref().map(|(p, _)| p.clone()),
        "channel": resolved.as_ref().map(|(_, c)| c.clone()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dossier_vide_invalide() {
        let dir = std::env::temp_dir().join(format!("scfm-install-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("logbackups")).unwrap();
        let p = dir.to_string_lossy().to_string();
        assert_eq!(validate_path_fs(&p), (false, false));
        std::fs::write(dir.join("Data.p4k"), b"").unwrap();
        std::fs::write(dir.join("logbackups").join("Game Build(1).LOG"), b"").unwrap();
        assert_eq!(validate_path_fs(&p), (true, true));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
