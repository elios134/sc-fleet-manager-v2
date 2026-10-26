// Loadouts minage et salvage construits depuis l'API UEX (cache AppMeta 14 j).

use super::*;

/* ───────────────────── Loadout minage (UEX cat 28/29/30) ─────────────────────
   Tetes laser (29), modules (30), gadgets (28) + leurs attributs (stats) + prix.
   Construit la donnee structuree lue par la page Loadout minage (calcul cote
   front). Mise en cache dans AppMeta ; rafraichie depuis UEX si perimee (>14 j).
   Donnees = faits de jeu via l'API publique UEX ; code original (clean-room). */
const MINING_MAX_AGE_SECS: u64 = 14 * 24 * 3600;

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
async fn meta_get(pool: &Pool<Sqlite>, key: &str) -> Option<String> {
    crate::commands::app_meta::get(pool, key).await
}
async fn meta_set(pool: &Pool<Sqlite>, key: &str, value: &str) -> Result<(), String> {
    crate::commands::app_meta::set(pool, key, value).await
}

/// f64 depuis un champ JSON nombre OU chaine (UEX renvoie parfois des chaines).
fn jf64(v: &Value, k: &str) -> Option<f64> {
    match v.get(k) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.replace(['%', ','], "").trim().parse().ok(),
        _ => None,
    }
}
/// f64 depuis une chaine d'attribut.
fn anum_str(s: &str) -> Option<f64> {
    // UEX mêle les formats : la virgule est le séparateur DÉCIMAL européen (« 3,5 »,
    // « 0,05 »), parfois avec une unité « % ». On la convertit en point (surtout PAS
    // la supprimer, sinon « 3,5 » deviendrait 35) avant de parser.
    s.replace('%', "").replace(',', ".").trim().parse::<f64>().ok()
}
/// Plage « min max » sous les diverses formes UEX : « 900 - 3600 », « 900-3600 »
/// (tiret sans espaces) ou « 0,05/0,15 » (virgule décimale + slash). Valeur seule → (v, v).
fn parse_power(s: &str) -> (f64, f64) {
    let t = s.replace(',', ".");
    let t = t.trim();
    for sep in [" - ", "/", "-"] {
        if let Some(i) = t.find(sep) {
            let a = t[..i].trim();
            let b = t[i + sep.len()..].trim();
            if let (Ok(x), Ok(y)) = (a.parse::<f64>(), b.parse::<f64>()) {
                return (x.min(y), x.max(y));
            }
        }
    }
    let v = t.parse::<f64>().unwrap_or(0.0);
    (v, v)
}
fn attr_map(rows: &[Value]) -> HashMap<i64, HashMap<String, String>> {
    let mut m: HashMap<i64, HashMap<String, String>> = HashMap::new();
    for r in rows {
        let id = r.get("id_item").and_then(|v| v.as_i64());
        let name = r.get("attribute_name").and_then(|v| v.as_str());
        if let (Some(id), Some(name)) = (id, name) {
            let val = match r.get("value") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                _ => String::new(),
            };
            m.entry(id).or_default().insert(name.to_string(), val);
        }
    }
    m
}
type PriceMaps = (HashMap<i64, f64>, HashMap<i64, Vec<(String, f64)>>);
fn price_map(rows: &[Value]) -> PriceMaps {
    let mut mn: HashMap<i64, f64> = HashMap::new();
    let mut loc: HashMap<i64, Vec<(String, f64)>> = HashMap::new();
    for r in rows {
        let Some(id) = r.get("id_item").and_then(|v| v.as_i64()) else { continue };
        let buy = jf64(r, "price_buy").unwrap_or(0.0);
        if buy <= 0.0 {
            continue;
        }
        let e = mn.entry(id).or_insert(buy);
        if buy < *e {
            *e = buy;
        }
        let term = r.get("terminal_name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if !term.is_empty() {
            loc.entry(id).or_default().push((term, buy));
        }
    }
    for v in loc.values_mut() {
        v.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    }
    (mn, loc)
}
/// Liste "ou acheter" (<=6 terminaux les moins chers) au format JSON.
fn buy_list(loc: &HashMap<i64, Vec<(String, f64)>>, id: i64) -> Value {
    let v: Vec<Value> = loc
        .get(&id)
        .map(|l| l.iter().take(6).map(|(t, p)| serde_json::json!({"terminal": t, "price": p})).collect())
        .unwrap_or_default();
    Value::Array(v)
}
fn aget<'a>(a: &'a HashMap<String, String>, k: &str) -> Option<&'a String> {
    a.get(k)
}
fn anum(a: &HashMap<String, String>, k: &str) -> Option<f64> {
    a.get(k).and_then(|s| anum_str(s))
}

/// Construit la donnee loadout (lasers/modules/gadgets) depuis l'API UEX.
async fn build_mining_loadout(client: &reqwest::Client) -> Result<Value, String> {
    // Tetes laser (cat 29)
    let l_items = get_data(client, "items/id_category/29").await?;
    let l_attr = attr_map(&get_data(client, "items_attributes/id_category/29").await?);
    let (l_mn, l_loc) = price_map(&get_data(client, "items_prices/id_category/29").await?);
    let lasers: Vec<Value> = l_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = l_attr.get(&id).cloned().unwrap_or_default();
            let (mnp, mxp) = parse_power(aget(&a, "Mining Laser Power").map(String::as_str).unwrap_or(""));
            Some(serde_json::json!({
                "name": name,
                "company": r.get("company_name").and_then(|v| v.as_str()).unwrap_or(""),
                "size": jf64(r, "size").or_else(|| anum(&a, "Size")).unwrap_or(0.0) as i64,
                "minPower": mnp, "maxPower": mxp,
                "extPower": anum(&a, "Extraction Laser Power"),
                "optRange": anum(&a, "Optimal Range"),
                "maxRange": anum(&a, "Maximum Range"),
                "resistance": anum(&a, "Resistance"),
                "instability": anum(&a, "Laser Instability"),
                "inert": anum(&a, "Inert Material Level"),
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "chargeRate": anum(&a, "Optimal Charge Window Rate"),
                "moduleSlots": anum(&a, "Module Slots").map(|v| v.round() as i64).unwrap_or(2),
                "price": l_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&l_loc, id),
            }))
        })
        .collect();

    // Modules (cat 30)
    let m_items = get_data(client, "items/id_category/30").await?;
    let m_attr = attr_map(&get_data(client, "items_attributes/id_category/30").await?);
    let (m_mn, m_loc) = price_map(&get_data(client, "items_prices/id_category/30").await?);
    let modules: Vec<Value> = m_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = m_attr.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "type": aget(&a, "Item Type").map(|s| s.trim().to_string()).unwrap_or_else(|| "Passive".into()),
                "powerPct": anum(&a, "Mining Laser Power"),
                "extPowerPct": anum(&a, "Extraction Laser Power"),
                "resistance": anum(&a, "Resistance"),
                "instability": anum(&a, "Laser Instability"),
                "inert": anum(&a, "Inert Material Level"),
                "chargeRate": anum(&a, "Optimal Charge Rate"),
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "overcharge": anum(&a, "Catastrophic Charge Rate"),
                "shatter": anum(&a, "Shatter Damage"),
                "uses": anum(&a, "Uses").map(|v| v.round() as i64).unwrap_or(0),
                "duration": anum(&a, "Duration"),
                "price": m_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&m_loc, id),
            }))
        })
        .collect();

    // Gadgets (cat 28)
    let g_items = get_data(client, "items/id_category/28").await?;
    let g_attr = attr_map(&get_data(client, "items_attributes/id_category/28").await?);
    let (g_mn, g_loc) = price_map(&get_data(client, "items_prices/id_category/28").await?);
    let gadgets: Vec<Value> = g_items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = g_attr.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "chargeWindow": anum(&a, "Optimal Charge Window Size"),
                "chargeRate": anum(&a, "Optimal Charge Window Rate"),
                "instability": anum(&a, "Laser Instability"),
                "resistance": anum(&a, "Resistance"),
                "cluster": anum(&a, "Cluster Modifier"),
                "price": g_mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&g_loc, id),
            }))
        })
        .collect();

    Ok(serde_json::json!({
        "generatedUnix": now_unix(),
        "lasers": lasers,
        "modules": modules,
        "gadgets": gadgets,
    }))
}

/// Donnee loadout minage : cache AppMeta, rafraichie depuis UEX si perimee (>14 j)
/// ou absente. En cas d'echec reseau, renvoie le cache existant s'il y en a un.
#[tauri::command]
pub async fn get_mining_loadout(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool = pool_from!(lock);

    let cached = meta_get(pool, "mining.loadoutData.v2").await;
    let synced: u64 = meta_get(pool, "mining.loadoutSyncedAt.v2")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let fresh = cached.is_some() && now_unix().saturating_sub(synced) < MINING_MAX_AGE_SECS;
    if fresh {
        if let Some(c) = &cached {
            if let Ok(v) = serde_json::from_str::<Value>(c) {
                return Ok(v);
            }
        }
    }

    let client = uex_client()?;
    match build_mining_loadout(&client).await {
        Ok(data) => {
            let s = data.to_string();
            let _ = meta_set(pool, "mining.loadoutData.v2", &s).await;
            let _ = meta_set(pool, "mining.loadoutSyncedAt.v2", &now_unix().to_string()).await;
            Ok(data)
        }
        Err(e) => {
            if let Some(c) = cached {
                if let Ok(v) = serde_json::from_str::<Value>(&c) {
                    return Ok(v);
                }
            }
            Err(e)
        }
    }
}

/// Construit la donnee salvage (modules scraper, cat 31) depuis l'API UEX.
async fn build_salvage_loadout(client: &reqwest::Client) -> Result<Value, String> {
    let items = get_data(client, "items/id_category/31").await?;
    let attrs = attr_map(&get_data(client, "items_attributes/id_category/31").await?);
    let (mn, loc) = price_map(&get_data(client, "items_prices/id_category/31").await?);
    let heads: Vec<Value> = items
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_i64())?;
            let name = r.get("name").and_then(|v| v.as_str())?;
            let a = attrs.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "name": name,
                "company": r.get("company_name").and_then(|v| v.as_str()).unwrap_or(""),
                "size": jf64(r, "size").or_else(|| anum(&a, "Size")).unwrap_or(0.0) as i64,
                // « Extraction Speed » est une PLAGE « 0,05/0,15 » → on prend le maximum
                // (débit plein). anum() échouerait sur le slash → vitesse à 0.
                "extractionSpeed": aget(&a, "Extraction Speed").map(|s| parse_power(s).1),
                "radius": anum(&a, "Radius"),
                "efficiency": anum(&a, "Extraction Efficiency"),
                "price": mn.get(&id).copied().unwrap_or(0.0),
                "buy": buy_list(&loc, id),
            }))
        })
        .collect();
    Ok(serde_json::json!({ "generatedUnix": now_unix(), "heads": heads }))
}

/// Donnee salvage : meme cache/repli que get_mining_loadout (rafraichi >14 j).
#[tauri::command]
pub async fn get_salvage_loadout(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let lock = db_instances.0.read().await;
    let pool = pool_from!(lock);

    let cached = meta_get(pool, "salvage.loadoutData.v2").await;
    let synced: u64 = meta_get(pool, "salvage.loadoutSyncedAt.v2")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if cached.is_some() && now_unix().saturating_sub(synced) < MINING_MAX_AGE_SECS {
        if let Some(c) = &cached {
            if let Ok(v) = serde_json::from_str::<Value>(c) {
                return Ok(v);
            }
        }
    }

    let client = uex_client()?;
    match build_salvage_loadout(&client).await {
        Ok(data) => {
            let s = data.to_string();
            let _ = meta_set(pool, "salvage.loadoutData.v2", &s).await;
            let _ = meta_set(pool, "salvage.loadoutSyncedAt.v2", &now_unix().to_string()).await;
            Ok(data)
        }
        Err(e) => {
            if let Some(c) = cached {
                if let Ok(v) = serde_json::from_str::<Value>(&c) {
                    return Ok(v);
                }
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod loadout_parse_tests {
    use super::{anum_str, parse_power};

    #[test]
    fn parse_power_handles_dash_without_spaces() {
        // Mining Laser Power UEX = « 900-3600 » (tiret sans espaces) — cassait avant.
        assert_eq!(parse_power("900-3600"), (900.0, 3600.0));
        assert_eq!(parse_power("189-1890"), (189.0, 1890.0));
    }

    #[test]
    fn parse_power_handles_spaced_dash_and_single() {
        assert_eq!(parse_power("900 - 3600"), (900.0, 3600.0));
        assert_eq!(parse_power("2590"), (2590.0, 2590.0));
    }

    #[test]
    fn parse_power_handles_salvage_range_with_comma_and_slash() {
        // Extraction Speed salvage = « 0,05/0,15 » → (0.05, 0.15), max = 0.15.
        let (mn, mx) = parse_power("0,05/0,15");
        assert!((mn - 0.05).abs() < 1e-9, "min={mn}");
        assert!((mx - 0.15).abs() < 1e-9, "max={mx}");
    }

    #[test]
    fn anum_str_treats_comma_as_decimal_not_deleted() {
        // « 3,5 » doit valoir 3.5, pas 35 (l'ancien .replace(',', "") le cassait).
        assert_eq!(anum_str("3,5"), Some(3.5));
        assert_eq!(anum_str("65"), Some(65.0));
        assert_eq!(anum_str("+25"), Some(25.0));
        assert_eq!(anum_str("0,05"), Some(0.05));
    }
}
