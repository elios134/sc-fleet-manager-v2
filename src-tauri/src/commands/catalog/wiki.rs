// Détail Wiki d'un objet au clic (descriptif, stats) et synchro des images.
use super::*;

/* ═════════════ DÉTAIL WIKI LAZY — descriptif + stats au clic (pas de bulk) ═════════ */

pub(crate) fn jstr(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
pub(crate) fn jnum(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}
/// Formate un nombre proprement (entier si rond).
pub(crate) fn numfmt(n: f64) -> String {
    if (n.fract()).abs() < 1e-9 {
        format!("{}", n as i64)
    } else {
        format!("{n:.1}")
    }
}

/// Détail d'un item depuis SC Wiki (`/api/v2/items/{uuid}`) : descriptif + meta + stats
/// normalisées (description_data + quelques stats combat typées). LAZY (appelé au clic).
/// Best-effort : renvoie un objet vide si l'uuid manque ou l'API échoue (jamais d'erreur dure).
#[tauri::command]
pub async fn get_item_wiki_detail(uuid: Option<String>) -> Result<Value, String> {
    let empty = json!({ "available": false, "description": null, "stats": [] });
    let Some(uuid) = uuid.filter(|s| !s.trim().is_empty()) else {
        return Ok(empty);
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("SCFleetManager/2.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(empty),
    };

    let resp = match client.get(format!("{WIKI_BASE}/items/{uuid}")).header("Accept", "application/json").send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(empty),
    };
    let json: Value = match resp.json().await {
        Ok(j) => j,
        Err(_) => return Ok(empty),
    };
    let it = json.get("data").unwrap_or(&json);

    // Descriptif : fr_FR sinon en_EN.
    let description = it
        .get("description")
        .and_then(|d| jstr(d, "fr_FR").or_else(|| jstr(d, "en_EN")));

    // Stats normalisées (liste {name,value}) : description_data (déjà adapté au type) +
    // quelques stats combat typées absentes de description_data.
    let mut stats: Vec<Value> = Vec::new();
    if let Some(dd) = it.get("description_data").and_then(|d| d.as_array()) {
        for e in dd {
            if let (Some(name), Some(value)) = (jstr(e, "name"), jstr(e, "value")) {
                stats.push(json!({ "name": name, "value": value }));
            }
        }
    }
    if let Some(w) = it.get("vehicle_weapon").filter(|v| v.is_object()) {
        if let Some(v) = jnum(w, "damage_per_shot") {
            stats.push(json!({ "name": "Damage / shot", "value": numfmt(v) }));
        }
        if let Some(v) = jnum(w, "rpm") {
            stats.push(json!({ "name": "Rate of fire", "value": format!("{} rpm", numfmt(v)) }));
        }
        if let Some(v) = jnum(w, "range") {
            stats.push(json!({ "name": "Range", "value": format!("{} m", numfmt(v)) }));
        }
    }
    if let Some(h) = it.get("durability").and_then(|d| jnum(d, "health")) {
        stats.push(json!({ "name": "Health", "value": numfmt(h) }));
    }

    // Image (bonus, souvent absente pour l'équipement fonctionnel) : images[0] en string
    // OU en objet {original_url|url}. Repli côté front sur l'icône de catégorie.
    let image = it
        .get("images")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|first| {
            first
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| jstr(first, "original_url").or_else(|| jstr(first, "url")))
        });

    Ok(json!({
        "available": true,
        "description": description,
        "manufacturer": it.get("manufacturer").and_then(|m| jstr(m, "name")).filter(|s| s != "Unknown"),
        "typeLabel": jstr(it, "type_label"),
        "subTypeLabel": jstr(it, "sub_type_label"),
        "size": it.get("size").and_then(|s| s.as_i64().or_else(|| s.as_str().and_then(|x| x.parse().ok()))),
        "grade": jstr(it, "grade"),
        "webUrl": jstr(it, "web_url"),
        "imageUrl": image,
        "stats": stats,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemImageSyncReport {
    pub pages: i64,
    pub with_image: i64,
    pub updated: i64,
}

/// Couverture complète des images d'objets : balaye SC Wiki /items (paginé), extrait
/// images[0] et l'écrit dans Item.imageUrl (jointure par uuid). Une seule passe (quelques
/// pages), best-effort par page. Beaucoup d'objets fonctionnels n'ont pas d'image → repli
/// icône côté UI.
#[tauri::command]
pub async fn sync_item_images(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<ItemImageSyncReport, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut map: Vec<(String, String)> = Vec::new(); // (uuid, imageUrl)
    let mut page = 1u32;
    let mut last_page = 1u32;
    let mut pages = 0i64;
    loop {
        let url = format!("{WIKI_BASE}/items?limit=100&page={page}");
        let json: Value = match client.get(&url).header("Accept", "application/json").send().await {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(j) => j,
                Err(_) => break,
            },
            _ => break,
        };
        pages += 1;
        if let Some(lp) = json.get("meta").and_then(|m| m.get("last_page")).and_then(|x| x.as_u64()) {
            last_page = lp as u32;
        }
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for it in arr {
                let Some(uuid) = jstr(it, "uuid") else { continue };
                let img = it
                    .get("images")
                    .and_then(|a| a.as_array())
                    .and_then(|a| a.first())
                    .and_then(|first| {
                        first
                            .as_str()
                            .map(|s| s.to_string())
                            .or_else(|| jstr(first, "original_url").or_else(|| jstr(first, "url")))
                    });
                if let Some(img) = img {
                    map.push((uuid, img));
                }
            }
        }
        page += 1;
        if page > last_page {
            break;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    let with_image = map.len() as i64;

    let lock = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut updated = 0i64;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (uuid, img) in &map {
        if let Ok(r) = sqlx::query("UPDATE Item SET imageUrl = ? WHERE uuid = ?")
            .bind(img)
            .bind(uuid)
            .execute(&mut *tx)
            .await
        {
            updated += r.rows_affected() as i64;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ItemImageSyncReport { pages, with_image, updated })
}
