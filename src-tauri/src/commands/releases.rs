// Historique des versions (releases GitHub du dépôt) : notes affichées par la fenêtre
// « Quoi de neuf » et l'historique de Paramètres › À propos. Lecture publique, sans token ;
// hors-ligne → erreur, le front n'affiche alors rien.
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const RELEASES_URL: &str = "https://api.github.com/repos/elios134/sc-fleet-manager-v2/releases?per_page=30";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReleaseInfo {
    /// Version sans le préfixe « v » (« 3.2.0 »).
    pub version: String,
    /// Date de publication ISO (« 2026-10-19T… »), si publiée.
    pub date: Option<String>,
    pub body: String,
}

/// Releases publiées (ni brouillon ni pré-version), dans l'ordre de l'API (plus récente d'abord).
pub fn map_releases(json: &Value) -> Vec<ReleaseInfo> {
    json.as_array()
        .map(|arr| {
            arr.iter()
                .filter(|r| !r.get("draft").and_then(Value::as_bool).unwrap_or(false))
                .filter(|r| !r.get("prerelease").and_then(Value::as_bool).unwrap_or(false))
                .filter_map(|r| {
                    let tag = r.get("tag_name")?.as_str()?;
                    Some(ReleaseInfo {
                        version: tag.trim_start_matches(['v', 'V']).to_string(),
                        date: r.get("published_at").and_then(Value::as_str).map(str::to_string),
                        body: r.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_releases() -> Result<Vec<ReleaseInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(map_releases(&json))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn releases_publiees_sans_prefixe_v() {
        let v = json!([
            { "tag_name": "v3.2.0", "published_at": "2026-10-19T10:00:00Z", "body": "## Nouveautés\n- **A** — b", "draft": false, "prerelease": false },
            { "tag_name": "v3.3.0-beta", "draft": false, "prerelease": true, "body": "x" },
            { "tag_name": "v9.9.9", "draft": true, "prerelease": false, "body": "x" },
            { "tag_name": "v3.1.1", "published_at": null, "body": null, "draft": false, "prerelease": false }
        ]);
        let r = map_releases(&v);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0], ReleaseInfo { version: "3.2.0".into(), date: Some("2026-10-19T10:00:00Z".into()), body: "## Nouveautés\n- **A** — b".into() });
        assert_eq!(r[1].version, "3.1.1");
        assert_eq!(r[1].body, "");
        assert!(map_releases(&json!({ "message": "rate limited" })).is_empty());
    }
}
