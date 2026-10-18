// Nom réel + image des objets de l'inventaire, depuis SC Wiki (`/items/<class_name>`),
// avec cache disque : le journal ne donne que la classe (« crlf_consumable_healing_01 »).
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const WIKI_ITEMS: &str = "https://api.star-citizen.wiki/api/v2/items";
/// Plafond de requêtes Wiki par appel (le reste au prochain affichage).
const MAX_FETCH: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMeta {
    pub name: Option<String>,
    pub image_url: Option<String>,
    /// Classement Wiki (« FPS.Consumable.Medical », « FPS.Armor.Torso »…) → catégorie UI.
    #[serde(default)]
    pub classification: Option<String>,
}

pub type MetaCache = BTreeMap<String, ItemMeta>;

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

/// `{data:{name, images:[{thumbnail_url|original_url}]}}` → méta ; None si pas d'objet.
pub fn meta_from_wiki(v: &Value) -> Option<ItemMeta> {
    let d = v.get("data")?;
    let name = s(d, "name");
    let first = d.get("images").and_then(Value::as_array).and_then(|a| a.first());
    let image_url = first.and_then(|f| s(f, "thumbnail_url").or_else(|| s(f, "original_url")));
    let classification = s(d, "classification");
    (name.is_some() || image_url.is_some()).then_some(ItemMeta { name, image_url, classification })
}

/// Classes demandées absentes du cache (dédoublonnées, ordre conservé).
pub fn missing(cache: &MetaCache, classes: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in classes {
        if !cache.contains_key(c) && !out.contains(c) {
            out.push(c.clone());
        }
    }
    out
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("inventory-items.json"))
}

async fn fetch_meta(client: &reqwest::Client, class: &str) -> Option<ItemMeta> {
    let resp = client.get(format!("{WIKI_ITEMS}/{class}")).header("Accept", "application/json").send().await.ok()?;
    let v: Value = resp.error_for_status().ok()?.json().await.ok()?;
    meta_from_wiki(&v)
}

/// Méta (nom, image) des classes demandées : cache disque, complété depuis SC Wiki.
/// Hors-ligne / objet inconnu : simplement absent (repli nom « joli » + icône côté UI).
#[tauri::command]
pub async fn inventory_item_meta(app: AppHandle, classes: Vec<String>) -> Result<MetaCache, String> {
    let path = cache_path(&app);
    let mut cache: MetaCache = path
        .as_deref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let todo = missing(&cache, &classes);
    if !todo.is_empty() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("SCFleetManager")
            .build()
            .map_err(|e| e.to_string())?;
        let mut added = false;
        for c in todo.iter().take(MAX_FETCH) {
            if let Some(m) = fetch_meta(&client, c).await {
                cache.insert(c.clone(), m);
                added = true;
            }
        }
        if added {
            if let (Some(p), Ok(t)) = (path.as_deref(), serde_json::to_string(&cache)) {
                let _ = std::fs::write(p, t);
            }
        }
    }
    Ok(classes.iter().filter_map(|c| cache.get(c).map(|m| (c.clone(), m.clone()))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn meta_prefere_la_vignette() {
        let v = json!({ "data": { "name": "MedPen (Hemozal)", "class_name": "crlf_consumable_healing_01", "classification": "FPS.Consumable.Medical",
            "images": [{ "original_url": "https://m/o.png", "thumbnail_url": "https://m/t.webp" }] } });
        let m = meta_from_wiki(&v).unwrap();
        assert_eq!(m.name.as_deref(), Some("MedPen (Hemozal)"));
        assert_eq!(m.image_url.as_deref(), Some("https://m/t.webp"));
        assert_eq!(m.classification.as_deref(), Some("FPS.Consumable.Medical"));
    }

    #[test]
    fn meta_repli_original_puis_sans_image() {
        let v = json!({ "data": { "name": "X", "images": [{ "original_url": "https://m/o.png" }] } });
        assert_eq!(meta_from_wiki(&v).unwrap().image_url.as_deref(), Some("https://m/o.png"));
        let v = json!({ "data": { "name": "Gold Box", "images": [] } });
        let m = meta_from_wiki(&v).unwrap();
        assert_eq!(m.name.as_deref(), Some("Gold Box"));
        assert!(m.image_url.is_none());
    }

    #[test]
    fn meta_reponse_invalide() {
        assert!(meta_from_wiki(&json!({ "message": "Not found" })).is_none());
    }

    #[test]
    fn classes_a_chercher_ignore_le_cache() {
        let mut cache = MetaCache::new();
        cache.insert("a".into(), ItemMeta { name: Some("A".into()), image_url: None, classification: None });
        let todo = missing(&cache, &["a".to_string(), "b".to_string(), "b".to_string()]);
        assert_eq!(todo, vec!["b".to_string()]);
    }
}
