// Carte stellaire V3 — géométrie + POI depuis notre CDN (jsDelivr), avec cache disque
// hors-ligne. Les textures, elles, se chargent en direct côté front (jsDelivr sert avec
// CORS). Ici on ne gère QUE le JSON géométrie. Données dérivées de VerseTime (attribution UI).
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{command, AppHandle, Manager};

const GEO_URL: &str = "https://cdn.jsdelivr.net/gh/elios134/sc-fleet-starmap-data@main/starmap-geo.json";

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("starmap-geo.json"))
}

/// Écrit le contenu brut dans le cache (best-effort).
fn write_cache(p: &Path, body: &str) -> std::io::Result<()> {
    std::fs::write(p, body)
}

/// Lit le cache et le parse ; None si absent / illisible / JSON invalide.
fn read_cache(p: &Path) -> Option<Value> {
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str::<Value>(&s).ok()
}

async fn fetch_text(url: &str, secs: u64) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(secs))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .header("User-Agent", "SCFleetManager")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// Géométrie + POI de la carte : réseau (CDN) si possible, sinon cache disque hors-ligne.
#[command]
pub async fn starmap_geometry(app: AppHandle) -> Result<Value, String> {
    let cache = cache_path(&app);
    match fetch_text(GEO_URL, 15).await {
        Ok(body) => match serde_json::from_str::<Value>(&body) {
            Ok(v) => {
                if let Some(p) = &cache {
                    let _ = write_cache(p, &body);
                }
                Ok(v)
            }
            Err(e) => cache
                .as_deref()
                .and_then(read_cache)
                .ok_or_else(|| format!("géométrie JSON invalide: {e}")),
        },
        Err(e) => cache
            .as_deref()
            .and_then(read_cache)
            .ok_or_else(|| format!("géométrie indisponible (hors-ligne): {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_roundtrip_et_validation() {
        let dir = std::env::temp_dir().join(format!("smtest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("starmap-geo.json");
        write_cache(&p, r#"{"systems":[],"bodies":[{"name":"x"}],"pois":[]}"#).unwrap();
        let v = read_cache(&p).expect("cache lisible");
        assert!(v.get("bodies").and_then(|b| b.as_array()).map(|a| !a.is_empty()).unwrap_or(false));
        write_cache(&p, "pas du json").unwrap();
        assert!(read_cache(&p).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
