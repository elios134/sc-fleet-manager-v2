// Lieux de minage (ResourceMiningLocation) depuis le wiki : /commodities (ressources minables)
// puis /commodities/{uuid} (lieux, clés de ressource → méthode et rareté). Remplace la lecture
// des dumps du Data.p4k. Une ligne par (minerai × lieu × méthode).
use super::*;

/// Normalise un nom de ressource en stem de jointure (port V1 + espace→_).
///   "ResourceType.Ore_Borase" → "borase" ; "Quantanium" → "quantanium" ; "Pressurized Ice" → "pressurized_ice"
pub fn normalise_to_stem(raw: &str) -> String {
    let mut s = raw.to_lowercase();
    if let Some(r) = s.strip_prefix("resourcetype.") {
        s = r.to_string();
    }
    if let Some(r) = s.strip_prefix("ore_") {
        s = r.to_string();
    } else if let Some(r) = s.strip_prefix("ore") {
        s = r.to_string();
    }
    if let Some(r) = s.strip_prefix("raw_") {
        s = r.to_string();
    } else if let Some(r) = s.strip_prefix("raw") {
        s = r.to_string();
    }
    s.trim().replace(' ', "_")
}

/// Alias de stem (port V1) : ice→pressurized_ice, quantanium→quantainium.
pub fn apply_stem_alias(stem: &str) -> String {
    match stem {
        "ice" => "pressurized_ice".to_string(),
        "quantanium" => "quantainium".to_string(),
        other => other.to_string(),
    }
}

/// Stem d'une ressource du wiki : « Agricium (Ore) », « Raw Ice », « Hephaestanite (R) ».
pub(crate) fn commodity_stem(name: &str) -> String {
    // Retire le suffixe entre parenthèses (« (Ore) », « (Raw) », « (R) ») puis le préfixe « Raw ».
    let base = name.split(" (").next().unwrap_or(name).trim();
    apply_stem_alias(&normalise_to_stem(base))
}

/// Méthode et rareté d'après la clé de ressource du wiki :
///   MineableRock_FPS_x → fps ; MineableRock_GroundVehicle_x → ground_vehicle ;
///   MineableRock_AsteroidRare_x / MineableRock_SurfaceEpic_x → ship + rareté.
fn method_and_rarity(key: &str) -> Option<(&'static str, Option<String>)> {
    let kind = key.split('_').nth(1)?;
    match kind {
        "FPS" => Some(("fps", None)),
        "GroundVehicle" => Some(("ground_vehicle", None)),
        _ => {
            let r = kind.strip_prefix("Asteroid").or_else(|| kind.strip_prefix("Surface"))?;
            Some(("ship", (!r.is_empty()).then(|| r.to_lowercase())))
        }
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct MiningRow {
    pub(crate) stem: String,
    pub(crate) resource_ref: String,
    pub(crate) system: String,
    pub(crate) body_key: String,
    pub(crate) body_name: String,
    pub(crate) method: &'static str,
    pub(crate) rarity: Option<String>,
}

/// Lignes d'une ressource (détail /commodities/{uuid}).
pub(crate) fn mining_rows(commodity: &Value) -> Vec<MiningRow> {
    let Some(name) = vstr(commodity, "name") else { return Vec::new() };
    let stem = commodity_stem(&name);
    let mut out: Vec<MiningRow> = Vec::new();
    for l in commodity.get("locations").and_then(Value::as_array).into_iter().flatten() {
        let (Some(body_key), Some(body_name)) = (vstr(l, "uuid"), vstr(l, "display_name").or_else(|| vstr(l, "name"))) else {
            continue;
        };
        // « Stanton System » → « stanton » (même forme que l'ancien import).
        let system = vstr(l, "system")
            .map(|s| s.trim_end_matches(" System").to_lowercase())
            .unwrap_or_default();
        for r in l.get("resources").and_then(Value::as_array).into_iter().flatten() {
            let Some((method, rarity)) = r.get("key").and_then(Value::as_str).and_then(method_and_rarity) else {
                continue;
            };
            // Un lieu peut lister plusieurs gisements de même méthode : on garde le premier.
            if out.iter().any(|x| x.body_key == body_key && x.method == method) {
                continue;
            }
            out.push(MiningRow {
                stem: stem.clone(),
                resource_ref: name.clone(),
                system: system.clone(),
                body_key: body_key.clone(),
                body_name: body_name.clone(),
                method,
                rarity,
            });
        }
    }
    out
}

/// Remplit ResourceMiningLocation depuis le wiki. Renvoie (lignes écrites, minerais distincts).
/// Aucune ligne obtenue (wiki hors ligne, format changé) → table laissée intacte.
pub(crate) async fn sync_mining_from_wiki(app: &AppHandle, client: &reqwest::Client) -> Result<(usize, usize), String> {
    let mut mineables: Vec<String> = Vec::new();
    let (mut page, mut last_page) = (1u32, 1u32);
    while page <= last_page {
        let list = fetch_with_retry(client, &format!("{WIKI_BASE}/commodities?limit=500&page={page}")).await?;
        last_page = list.get("meta").and_then(|m| vi64(m, "last_page")).unwrap_or(1).max(1) as u32;
        for c in list.get("data").and_then(Value::as_array).into_iter().flatten() {
            if vbool(c, "is_mineable") && vstr(c, "kind").as_deref() == Some("mineable") {
                if let Some(u) = vstr(c, "uuid") {
                    mineables.push(u);
                }
            }
        }
        page += 1;
    }

    let mut rows: Vec<MiningRow> = Vec::new();
    for uuid in &mineables {
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
        match fetch_with_retry(client, &format!("{WIKI_BASE}/commodities/{uuid}")).await {
            Ok(d) => rows.extend(mining_rows(d.get("data").unwrap_or(&d))),
            Err(e) => eprintln!("[wiki_sync] minerai {uuid} ignoré : {e}"),
        }
    }
    if rows.is_empty() {
        return Ok((0, 0));
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) else {
        return Err(format!("Base de données non chargée : {DB_URL}"));
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ResourceMiningLocation").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    for r in &rows {
        sqlx::query(
            "INSERT OR IGNORE INTO ResourceMiningLocation
               (resourceStem, resourceRef, systemName, rawBodyKey, bodyName, miningMethod, rarity, source, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'wiki', datetime('now'))",
        )
        .bind(&r.stem)
        .bind(&r.resource_ref)
        .bind(&r.system)
        .bind(&r.body_key)
        .bind(&r.body_name)
        .bind(r.method)
        .bind(&r.rarity)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    let stems: std::collections::HashSet<&str> = rows.iter().map(|r| r.stem.as_str()).collect();
    Ok((rows.len(), stems.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stems_des_noms_du_wiki() {
        assert_eq!(commodity_stem("Agricium (Ore)"), "agricium");
        assert_eq!(commodity_stem("Raw Ice"), "pressurized_ice");
        assert_eq!(commodity_stem("Hephaestanite (R)"), "hephaestanite");
        assert_eq!(commodity_stem("Quantainium (Raw)"), "quantainium");
        assert_eq!(commodity_stem("Raw Silicon"), "silicon");
        assert_eq!(commodity_stem("Hadanite"), "hadanite");
        // Même stem que celui calculé depuis le nom d'ingrédient du plan.
        assert_eq!(apply_stem_alias(&normalise_to_stem("Agricium")), "agricium");
    }

    fn loc(name: &str, system: &str, uuid: &str, keys: &[&str]) -> Value {
        json!({ "display_name": name, "system": system, "uuid": uuid,
                "resources": keys.iter().map(|k| json!({ "key": k })).collect::<Vec<_>>() })
    }

    #[test]
    fn methode_rarete_et_systeme() {
        let c = json!({ "name": "Agricium (Ore)", "locations": [
            loc("ARC L3", "Stanton System", "u1", &["MineableRock_AsteroidUncommon_Agricium", "MineableRock_AsteroidEpic_Agricium"]),
            loc("Daymar", "Stanton System", "u2", &["MineableRock_SurfaceEpic_Agricium"]),
        ]});
        let r = mining_rows(&c);
        assert_eq!(r.len(), 2, "un lieu × une méthode = une ligne");
        assert_eq!(r[0], MiningRow {
            stem: "agricium".into(), resource_ref: "Agricium (Ore)".into(), system: "stanton".into(),
            body_key: "u1".into(), body_name: "ARC L3".into(), method: "ship", rarity: Some("uncommon".into()),
        });
        assert_eq!(r[1].rarity.as_deref(), Some("epic"));
    }

    #[test]
    fn methodes_a_pied_et_vehicule() {
        let c = json!({ "name": "Hadanite", "locations": [
            loc("Aberdeen", "Pyro System", "a", &["MineableRock_FPS_Hadanite", "MineableRock_GroundVehicle_Hadanite"]),
        ]});
        let r = mining_rows(&c);
        assert_eq!(r.iter().map(|x| x.method).collect::<Vec<_>>(), vec!["fps", "ground_vehicle"]);
        assert_eq!(r[0].system, "pyro");
        assert_eq!(r[0].rarity, None);
    }

    #[test]
    fn lieu_incomplet_ignore() {
        let c = json!({ "name": "Gold (Ore)", "locations": [
            { "display_name": "Sans uuid", "system": "Stanton System", "resources": [{ "key": "MineableRock_AsteroidRare_Gold" }] },
            loc("Sans ressource", "Stanton System", "z", &[]),
        ]});
        assert!(mining_rows(&c).is_empty());
    }
}
