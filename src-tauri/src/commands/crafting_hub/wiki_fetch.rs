// Fiche et recyclage des plans depuis le SC Wiki (cache mémoire, extraction du démantèlement).
use super::*;

/// Cache mémoire des réponses Wiki (données de référence immuables) : évite le double
/// `/blueprints/{id}` (fiche + recyclage) et les re-fetch à chaque réouverture de fiche.
/// TTL court par sécurité ; clé = URL.
pub(crate) const WIKI_CACHE_TTL: Duration = Duration::from_secs(15 * 60);
pub(crate) static WIKI_CACHE: LazyLock<Mutex<HashMap<String, (Instant, Value)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// GET JSON best-effort pour la modale (timeout court, aucune reprise). None si échec.
/// Sert depuis le cache mémoire si l'URL y est fraîche (< TTL).
pub(crate) async fn fetch_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    if let Ok(cache) = WIKI_CACHE.lock() {
        if let Some((at, v)) = cache.get(url) {
            if at.elapsed() < WIKI_CACHE_TTL {
                return Some(v.clone());
            }
        }
    }
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let value = resp.json::<Value>().await.ok()?;
    if let Ok(mut cache) = WIKI_CACHE.lock() {
        cache.insert(url.to_string(), (Instant::now(), value.clone()));
    }
    Some(value)
}

/// String non vide pour une clé d'un sous-objet JSON.
pub(crate) fn jstr(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Détails de l'objet produit pour la modale. 2 appels best-effort :
/// `/blueprints/{id}` (→ uuid de l'output) puis `/items/{uuid}`. None si indisponible —
/// la modale s'ouvre alors sans le bloc détaillé.
pub(crate) async fn fetch_item_details(blueprint_id: &str) -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("SCFleetManager/2.0")
        .build()
        .ok()?;

    // 1) uuid de l'objet produit (non stocké en base, récupéré live).
    let bp = fetch_json(&client, &format!("{WIKI_BASE}/blueprints/{blueprint_id}")).await?;
    let body = bp.get("data").unwrap_or(&bp);
    let output_uuid = jstr(body, "output_item_uuid")
        .or_else(|| body.get("output").and_then(|o| jstr(o, "uuid")))?;

    // 2) détails de l'objet (/items résout l'uuid de l'output, même référentiel).
    let item = fetch_json(&client, &format!("{WIKI_BASE}/items/{output_uuid}")).await?;
    let it = item.get("data").unwrap_or(&item);

    // description : fr_FR sinon en_EN.
    let description = it
        .get("description")
        .and_then(|d| jstr(d, "fr_FR").or_else(|| jstr(d, "en_EN")));
    let manufacturer = it
        .get("manufacturer")
        .and_then(|m| jstr(m, "name"))
        .filter(|s| s != "Unknown");

    // images[0] en string OU en objet {original_url|url} (cf. catalog.rs) — vignette de repli
    // pour les blueprints pas encore re-synchronisés (imageUrl non persisté).
    let image_url = it
        .get("images")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|first| {
            first
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| jstr(first, "original_url").or_else(|| jstr(first, "url")))
        });

    Some(json!({
        "description": description,
        "manufacturer": manufacturer,
        "itemType": jstr(it, "type_label"),
        "subType": jstr(it, "sub_type_label"),
        "size": it.get("size").and_then(|s| s.as_i64()),
        "grade": jstr(it, "grade"),
        "className": jstr(it, "class_name"),
        "imageUrl": image_url,
    }))
}

/// Extrait le bloc « démantèlement » (recyclage) d'un JSON blueprint Wiki (clés snake_case) :
/// temps + rendement + ressources rendues (SCU). Value::Null si aucune donnée.
pub(crate) fn extract_dismantle(body: &Value) -> Value {
    let returns: Vec<Value> = body
        .get("dismantle_returns")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    json!({
                        "name": jstr(r, "name"),
                        "resourceUuid": jstr(r, "resource_type_uuid"),
                        "quantityScu": r.get("quantity_scu").and_then(|v| v.as_f64()),
                        "webUrl": jstr(r, "web_url"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let d = body.get("dismantle").filter(|v| !v.is_null());
    if d.is_none() && returns.is_empty() {
        return Value::Null;
    }
    json!({
        "timeSeconds": d.and_then(|x| x.get("time_seconds")).and_then(|v| v.as_u64()),
        "timeLabel": d.and_then(|x| jstr(x, "time_label")),
        "efficiency": d.and_then(|x| x.get("efficiency")).and_then(|v| v.as_f64()),
        "returns": returns,
    })
}

/// Démantèlement d'un blueprint récupéré en live depuis l'API Wiki (/blueprints/{id}).
/// Value::Null si indisponible (réseau/absence). Une seule requête, à l'ouverture de la fiche.
pub(crate) async fn fetch_dismantle(blueprint_id: &str) -> Value {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("SCFleetManager/2.0")
        .build()
    else {
        return Value::Null;
    };
    let Some(bp) = fetch_json(&client, &format!("{WIKI_BASE}/blueprints/{blueprint_id}")).await
    else {
        return Value::Null;
    };
    let body = bp.get("data").unwrap_or(&bp);
    extract_dismantle(body)
}
