// Feed des packs (notre CDN, lien seul) + sources perso collées par le joueur.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FR_FOLDER: &str = "french_(france)";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Pack {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub lang: Vec<String>,
    pub folder: String,
    pub url: String,
    pub featured: bool,
    pub updated_at: Option<String>,
    pub custom: bool,
}

/// `{packs:[...]}` → packs valides (id/url/folder requis ; les autres sont ignorés).
pub fn parse_feed(json: &str) -> Result<Vec<Pack>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("feed invalide : {e}"))?;
    let arr = v.get("packs").and_then(Value::as_array).ok_or("feed sans liste de packs")?;
    Ok(arr
        .iter()
        .filter_map(|p| serde_json::from_value::<Pack>(p.clone()).ok())
        .filter(|p| !p.id.is_empty() && !p.url.is_empty() && !p.folder.is_empty())
        .map(|p| Pack { custom: false, ..p })
        .collect())
}

/// URL perso : https obligatoire, `github.com/…/blob/…` → raw, chemin finissant par .ini.
pub fn normalize_source_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    let rest = url.strip_prefix("https://").ok_or("L'adresse doit commencer par https://")?;
    let path = rest.split(['?', '#']).next().unwrap_or("");
    // Fichier .ini (global.ini ou variante d'auteur type globalfr.ini) ; le contenu est
    // ensuite vérifié par ini::is_plausible avant toute persistance.
    if !path.to_lowercase().ends_with(".ini") {
        return Err("L'adresse doit pointer vers un fichier .ini (global.ini)".into());
    }
    if let Some(gh) = rest.strip_prefix("github.com/") {
        let parts: Vec<&str> = gh.splitn(4, '/').collect();
        if parts.len() == 4 && parts[2] == "blob" {
            return Ok(format!("https://raw.githubusercontent.com/{}/{}/{}", parts[0], parts[1], parts[3]));
        }
    }
    Ok(url.to_string())
}

/// Pack installable issu d'une source perso.
pub fn custom_pack(name: &str, url: &str) -> Pack {
    Pack {
        id: format!("custom:{url}"),
        name: name.to_string(),
        lang: vec!["fr".into()],
        folder: FR_FOLDER.into(),
        url: url.to_string(),
        custom: true,
        ..Pack::default()
    }
}

/// Vitrine : featured d'abord, puis feed, puis perso ; dédoublonnée par URL.
pub fn merge_packs(feed: Vec<Pack>, custom: Vec<Pack>) -> Vec<Pack> {
    let (featured, rest): (Vec<Pack>, Vec<Pack>) = feed.into_iter().partition(|p| p.featured);
    let mut out: Vec<Pack> = Vec::new();
    for p in featured.into_iter().chain(rest).chain(custom) {
        if !out.iter().any(|o| o.url == p.url) {
            out.push(p);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"{"packs":[
      {"id":"a","name":"A","author":"x","description":"d","lang":["fr"],"folder":"french_(france)","url":"https://h/a/global.ini"},
      {"id":"b","name":"B","author":"y","description":"d","lang":["fr"],"folder":"french_(france)","url":"https://h/b/global.ini","featured":true,"updatedAt":"2026-10-01"}
    ]}"#;

    #[test]
    fn parse_feed_ok() {
        let p = parse_feed(FEED).unwrap();
        assert_eq!(p.len(), 2);
        assert!(!p[0].featured && p[1].featured);
        assert_eq!(p[1].updated_at.as_deref(), Some("2026-10-01"));
        assert!(!p[0].custom);
    }

    #[test]
    fn parse_feed_ignore_pack_incomplet() {
        let p = parse_feed(r#"{"packs":[{"id":"a","name":"A"},{"id":"c","name":"C","folder":"french_(france)","url":"https://h/c/global.ini"}]}"#).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].id, "c");
    }

    #[test]
    fn parse_feed_json_invalide_err() {
        assert!(parse_feed("<html>").is_err());
    }

    #[test]
    fn url_blob_vers_raw() {
        assert_eq!(
            normalize_source_url("https://github.com/o/r/blob/main/fr/global.ini").unwrap(),
            "https://raw.githubusercontent.com/o/r/main/fr/global.ini"
        );
    }

    #[test]
    fn url_query_acceptee() {
        assert!(normalize_source_url("https://h/x/global.ini?raw=1").is_ok());
        assert!(normalize_source_url("https://h/x/GLOBAL.INI").is_ok());
    }

    #[test]
    fn url_variante_ini_acceptee() {
        assert!(normalize_source_url("https://raw.githubusercontent.com/GerbyTV/SCTMN/refs/heads/main/globalfr.ini").is_ok());
    }

    #[test]
    fn url_pas_global_ini_refusee() {
        assert!(normalize_source_url("https://h/x/readme.md").is_err());
    }

    #[test]
    fn url_http_refusee() {
        assert!(normalize_source_url("http://h/x/global.ini").is_err());
    }

    #[test]
    fn url_trim() {
        assert_eq!(normalize_source_url("  https://h/global.ini \n").unwrap(), "https://h/global.ini");
    }

    #[test]
    fn custom_pack_champs() {
        let p = custom_pack("Mon pack", "https://h/global.ini");
        assert_eq!(p.id, "custom:https://h/global.ini");
        assert_eq!(p.folder, "french_(france)");
        assert!(p.custom && !p.featured);
    }

    #[test]
    fn merge_featured_en_tete_et_dedoublonne() {
        let feed = parse_feed(FEED).unwrap();
        let custom = vec![custom_pack("dup", "https://h/a/global.ini"), custom_pack("m", "https://h/m/global.ini")];
        let ids: Vec<String> = merge_packs(feed, custom).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["b", "a", "custom:https://h/m/global.ini"]);
    }
}
