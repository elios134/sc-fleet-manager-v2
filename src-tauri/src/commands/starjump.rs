// Manifeste Starjump (images top-down) — download + cache + slim, calque V1 (starjumpSync.ts).
// Le hash MD5 des images n'est pas calculable : il faut le manifeste. On télécharge
// hangar.link/ships.json (best-effort, réutilise reqwest comme la sync SC Wiki), on le met
// en cache dans le répertoire de données de l'app, et on renvoie une version « slim »
// (fleetview/slug + hash top_l/top_s/top_xs). Le front garde un bundle slim de repli.
//
// ⚠️ ÉTHIQUE : usage en cours de dev. Ne pas publier/release ces images publiquement.

use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const MANIFEST_URL: &str = "https://hangar.link/ships.json";
const CACHE_FILE: &str = "starjump-ships-cache.json";
const MAX_AGE_SECS: u64 = 86_400; // re-télécharge au plus une fois par jour
const FETCH_TIMEOUT_SECS: u64 = 15;

#[derive(Serialize)]
pub struct SlimShip {
    fv: String,
    slug: String,
    l: Option<String>,
    s: Option<String>,
    xs: Option<String>,
}

/// Réduit le manifeste complet aux seuls champs utiles à l'image top-down.
/// Indexe la variante `official` (sinon la 1ʳᵉ), slug = variant.slug || ship.slug.
/// Accepte un array direct OU un objet { ships: [...] } (comme buildIndexFromShips V1).
fn slim_from_manifest(text: &str) -> Vec<SlimShip> {
    let parsed: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let ships = parsed
        .as_array()
        .cloned()
        .or_else(|| parsed.get("ships").and_then(|s| s.as_array()).cloned())
        .unwrap_or_default();

    let mut out = Vec::new();
    for s in ships {
        let fv = s
            .get("fleetview")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if fv.is_empty() {
            continue;
        }
        let ship_slug = s.get("slug").and_then(|x| x.as_str()).unwrap_or("");
        let Some(variants) = s.get("variants").and_then(|v| v.as_array()) else {
            continue;
        };
        let variant = variants
            .iter()
            .find(|v| v.get("official").and_then(|o| o.as_bool()).unwrap_or(false))
            .or_else(|| variants.first());
        let Some(variant) = variant else { continue };

        let vslug = variant.get("slug").and_then(|x| x.as_str()).unwrap_or("");
        let slug = if !vslug.is_empty() { vslug } else { ship_slug };

        let hash = |key: &str| -> Option<String> {
            variant
                .get(key)
                .and_then(|e| e.get("hash"))
                .and_then(|h| h.as_str())
                .map(|s| s.to_string())
        };
        let l = hash("top_l");
        let sm = hash("top_s");
        let xs = hash("top_xs");
        if l.is_none() && sm.is_none() && xs.is_none() {
            continue;
        }
        out.push(SlimShip {
            fv,
            slug: slug.to_string(),
            l,
            s: sm,
            xs,
        });
    }
    out
}

/// Renvoie le manifeste slim. Priorité : cache frais (< 1 j) → CDN (best-effort, met en
/// cache) → cache périmé → vide (le front bascule alors sur son bundle slim embarqué).
#[tauri::command]
pub async fn get_starjump_ships(app: AppHandle) -> Result<Vec<SlimShip>, String> {
    let cache_path = app.path().app_data_dir().ok().map(|d| d.join(CACHE_FILE));

    // 1. Cache frais → sert directement.
    if let Some(ref p) = cache_path {
        if let Ok(meta) = std::fs::metadata(p) {
            if let Ok(modified) = meta.modified() {
                if SystemTime::now()
                    .duration_since(modified)
                    .map(|age| age < Duration::from_secs(MAX_AGE_SECS))
                    .unwrap_or(false)
                {
                    if let Ok(text) = std::fs::read_to_string(p) {
                        let slim = slim_from_manifest(&text);
                        if !slim.is_empty() {
                            return Ok(slim);
                        }
                    }
                }
            }
        }
    }

    // 2. Téléchargement CDN (best-effort).
    let downloaded = (|| async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
            .user_agent("SCFleetManager/2.0")
            .build()
            .ok()?;
        let resp = client.get(MANIFEST_URL).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        resp.text().await.ok()
    })()
    .await;

    if let Some(text) = downloaded {
        let slim = slim_from_manifest(&text);
        if !slim.is_empty() {
            if let Some(ref p) = cache_path {
                if let Some(dir) = p.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(p, &text);
            }
            return Ok(slim);
        }
    }

    // 3. Échec réseau → cache périmé s'il existe.
    if let Some(ref p) = cache_path {
        if let Ok(text) = std::fs::read_to_string(p) {
            let slim = slim_from_manifest(&text);
            if !slim.is_empty() {
                return Ok(slim);
            }
        }
    }

    // 4. Rien : le front sert son bundle slim de repli.
    Ok(vec![])
}
