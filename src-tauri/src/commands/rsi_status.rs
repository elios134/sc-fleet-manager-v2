// Phase 0 — Statut des serveurs RSI en direct.
//
// La page de statut RSI (générateur cState) expose un flux JSON officiel à
// https://status.robertsspaceindustries.com/index.json — bien plus fiable que scraper
// le HTML. On en extrait le statut GLOBAL (summaryStatus) et chaque composant
// (Persistent Universe, Platform, Arena Commander…) avec son état (systems[].status).
//
// Lecture seule, donnée publique, aucune authentification.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

// La page de statut (cState) expose un flux JSON officiel : bien plus fiable que
// scraper le HTML. { summaryStatus, systems: [{ name, status, category }] }.
const STATUS_URL: &str = "https://status.robertsspaceindustries.com/index.json";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStatus {
    pub name: String,
    pub status: String, // operational | degraded | partial | major | maintenance | unknown
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RsiStatus {
    pub overall: String,       // operational | degraded | major | maintenance | unknown
    pub overall_label: String, // texte brut du bandeau (ex. "All Systems Operational")
    pub components: Vec<ComponentStatus>,
}

/// Normalise un libellé de statut (EN) vers nos codes internes.
fn normalize_status(label: &str) -> &'static str {
    let l = label.to_lowercase();
    if l.contains("maintenance") {
        "maintenance"
    } else if l.contains("major") {
        "major"
    } else if l.contains("partial") {
        "partial"
    } else if l.contains("degraded") || l.contains("minor") || l.contains("degrad") {
        "degraded"
    } else if l.contains("operational") || l.contains("all systems") {
        "operational"
    } else {
        "unknown"
    }
}

/// Met une majuscule initiale et remplace les séparateurs (« major_outage » → « Major outage »).
fn prettify(s: &str) -> String {
    let spaced = s.replace(['_', '-'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => spaced,
    }
}

/// Parse le flux index.json de la page de statut RSI en RsiStatus.
fn parse_index_json(body: &str) -> Option<RsiStatus> {
    let v: Value = serde_json::from_str(body).ok()?;
    let summary = v
        .get("summaryStatus")
        .and_then(|x| x.as_str())
        .unwrap_or("operational");
    let overall = normalize_status(summary).to_string();
    let overall_label = prettify(summary);

    let mut components = Vec::new();
    if let Some(systems) = v.get("systems").and_then(|x| x.as_array()) {
        for s in systems {
            let name = s
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let st = s.get("status").and_then(|x| x.as_str()).unwrap_or("operational");
            components.push(ComponentStatus {
                name,
                status: normalize_status(st).to_string(),
            });
            if components.len() >= 12 {
                break;
            }
        }
    }
    Some(RsiStatus {
        overall,
        overall_label,
        components,
    })
}

fn unknown_status() -> RsiStatus {
    RsiStatus {
        overall: "unknown".into(),
        overall_label: "Statut indisponible".into(),
        components: Vec::new(),
    }
}

/// Statut serveurs RSI (lecture pure). Ne échoue jamais en cas de réseau KO : renvoie
/// un statut "unknown" exploitable par le widget. `Value` pour rester souple côté front.
#[tauri::command]
pub async fn get_rsi_server_status() -> Result<Value, String> {
    // User-Agent navigateur : RSI (Cloudflare) rejette les UA non navigateur.
    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(serde_json::to_value(unknown_status()).unwrap()),
    };

    let body = match client
        .get(STATUS_URL)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp.text().await.unwrap_or_default(),
        _ => return Ok(serde_json::to_value(unknown_status()).unwrap()),
    };

    let status = parse_index_json(&body).unwrap_or_else(unknown_status);
    Ok(serde_json::to_value(status).map_err(|e| e.to_string())?)
}
