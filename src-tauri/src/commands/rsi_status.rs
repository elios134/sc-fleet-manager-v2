// Phase 0 — Statut des serveurs RSI en direct.
//
// Récupère la page de statut publique de RSI (https://status.robertsspaceindustries.com/)
// et en extrait : un statut GLOBAL fiable (bandeau cState) + la liste des composants
// (Persistent Universe, Platform, Arena Commander…) avec leur état quand parsable.
//
// La page est générée par cState (générateur de status-page statique). Le statut GLOBAL
// est dérivé du texte du bandeau (très stable) ; les composants sont parsés au mieux et
// peuvent évoluer avec le thème — d'où la dégradation gracieuse vers "unknown".
//
// Lecture seule, donnée publique, aucune authentification.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const STATUS_URL: &str = "https://status.robertsspaceindustries.com/";

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

/// Statut global depuis le bandeau cState (phrases stables). Repli sur le pire état trouvé
/// parmi les composants si le bandeau n'est pas reconnu.
fn parse_overall(html: &str, components: &[ComponentStatus]) -> (String, String) {
    // cState place le résumé dans un élément à classe contenant "status" + texte parlant.
    let banner_re = regex::Regex::new(
        r#"(?is)<[^>]*class="[^"]*(?:page-status|status-)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{6,80})"#,
    )
    .ok();
    let raw_label = banner_re
        .as_ref()
        .and_then(|re| re.captures(html))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| {
            let l = s.to_lowercase();
            l.contains("system")
                || l.contains("operational")
                || l.contains("outage")
                || l.contains("maintenance")
                || l.contains("degraded")
        });

    if let Some(label) = raw_label {
        let code = normalize_status(&label);
        return (code.to_string(), label);
    }

    // Repli : pire état parmi les composants (ordre de gravité décroissant).
    let severity = |s: &str| match s {
        "major" => 4,
        "partial" => 3,
        "maintenance" => 2,
        "degraded" => 1,
        _ => 0,
    };
    let worst = components
        .iter()
        .map(|c| c.status.as_str())
        .max_by_key(|s| severity(s));
    match worst {
        Some("major") => ("major".into(), "Major Service Outage".into()),
        Some("partial") => ("partial".into(), "Partial System Outage".into()),
        Some("maintenance") => ("maintenance".into(), "Service Under Maintenance".into()),
        Some("degraded") => ("degraded".into(), "Degraded Performance".into()),
        Some("operational") => ("operational".into(), "All Systems Operational".into()),
        _ => ("unknown".into(), "Statut indisponible".into()),
    }
}

/// Composants cState : chaque système porte un nom (classe "name") et un libellé d'état
/// à proximité. On capture le nom puis le 1er mot-clé de statut connu qui suit (fenêtre
/// courte) — parsing best-effort, tolérant aux variations de thème.
fn parse_components(html: &str) -> Vec<ComponentStatus> {
    let name_re = match regex::Regex::new(
        r#"(?is)class="[^"]*\bname\b[^"]*"[^>]*>\s*([^<]{2,60}?)\s*<"#,
    ) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let status_kw = regex::Regex::new(
        r"(?i)(operational|degraded performance|partial (?:system )?outage|major (?:service )?outage|under maintenance|maintenance)",
    )
    .ok();

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for caps in name_re.captures_iter(html) {
        let full = caps.get(0).unwrap();
        let name = caps[1].trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        // Fenêtre de 400 caractères après le nom pour trouver le libellé d'état.
        let tail_start = full.end();
        let tail_end = (tail_start + 400).min(html.len());
        let window = &html[tail_start..tail_end];
        let status = status_kw
            .as_ref()
            .and_then(|re| re.find(window))
            .map(|m| normalize_status(m.as_str()))
            .unwrap_or("unknown");
        out.push(ComponentStatus {
            name,
            status: status.to_string(),
        });
        if out.len() >= 12 {
            break;
        }
    }
    out
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

    let html = match client.get(STATUS_URL).send().await {
        Ok(resp) if resp.status().is_success() => resp.text().await.unwrap_or_default(),
        _ => return Ok(serde_json::to_value(unknown_status()).unwrap()),
    };

    let components = parse_components(&html);
    let (overall, overall_label) = parse_overall(&html, &components);
    let status = RsiStatus {
        overall,
        overall_label,
        components,
    };
    Ok(serde_json::to_value(status).map_err(|e| e.to_string())?)
}
