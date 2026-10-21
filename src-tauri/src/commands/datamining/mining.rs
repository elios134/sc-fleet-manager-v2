// Localisations de minage (ResourceMiningLocation) depuis les dumps.
use super::*;

/* ════════════════ Localisations de minage (ResourceMiningLocation) ═══════════ */
// Port Rust de miningLocationsParser.ts : cascade provider → preset → entité mineable
// → composition → élément → resourceType. Une ligne par (resource × corps × méthode).

/// Normalise un nom/_RecordName_ de ressource en stem de jointure (port V1 + espace→_).
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

/// Alias de stem (port V1 STEM_ALIASES) : ice→pressurized_ice, quantanium→quantainium.
pub fn apply_stem_alias(stem: &str) -> String {
    match stem {
        "ice" => "pressurized_ice".to_string(),
        "quantanium" => "quantainium".to_string(),
        other => other.to_string(),
    }
}

pub(crate) fn group_to_method(g: &str) -> Option<&'static str> {
    match g.to_lowercase().as_str() {
        "fps_mineables" => Some("fps"),
        "groundvehicle_mineables" => Some("ground_vehicle"),
        "spaceship_mineables" => Some("ship"),
        _ => None,
    }
}

pub(crate) fn rarity_from_preset(p: &Path) -> Option<String> {
    let base = p.file_stem()?.to_str()?.to_lowercase();
    let rest = base.strip_prefix("mining_")?;
    for r in ["common", "uncommon", "rare", "epic", "legendary"] {
        if rest.strip_prefix(r).map(|s| s.starts_with('_')).unwrap_or(false) {
            return Some(r.to_string());
        }
    }
    None
}

/// systemName + rawBodyKey depuis le chemin d'un provider (.../system/<sys>/.../<body>.json).
pub(crate) fn loc_from_provider(p: &Path) -> Option<(String, String)> {
    let comps: Vec<String> = p
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(|s| s.to_lowercase()))
        .collect();
    let idx = comps.iter().position(|s| s == "system")?;
    let system = comps.get(idx + 1)?.clone();
    let file = p.file_stem()?.to_str()?.to_lowercase();
    let body = file.strip_prefix("hpp_").unwrap_or(&file).to_string();
    Some((system, body))
}

/// Résout un file:// DataCore relativement à la racine du dump (mining_dump).
pub(crate) fn dump_path(url: &str, root: &Path) -> Option<PathBuf> {
    let idx = url.find("libs/foundry/records/")?;
    Some(root.join(url[idx..].replace('/', std::path::MAIN_SEPARATOR_STR)))
}

/// Lit (avec cache) un JSON DataCore. None si illisible/invalide.
pub(crate) fn read_cached<'a>(cache: &'a mut HashMap<PathBuf, Option<Value>>, p: &Path) -> Option<&'a Value> {
    if !cache.contains_key(p) {
        let v = fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok());
        cache.insert(p.to_path_buf(), v);
    }
    cache.get(p).and_then(|o| o.as_ref())
}

/// Nom lisible du corps via starmap (loc key → global.ini). None si non résolu.
pub(crate) fn resolve_body_name(
    mining_root: &Path,
    ini: Option<&HashMap<String, String>>,
    system: &str,
    body: &str,
    body_cache: &mut HashMap<String, Option<String>>,
    file_cache: &mut HashMap<PathBuf, Option<Value>>,
) -> Option<String> {
    let key = format!("{system}|{body}");
    if let Some(v) = body_cache.get(&key) {
        return v.clone();
    }
    let dir = mining_root
        .join("libs").join("foundry").join("records").join("starmap").join("pu").join("system")
        .join(system).join(body);
    let candidates = [dir.join(format!("{body}.json")), dir.join(format!("starmapobject.{body}.json"))];
    let mut resolved: Option<String> = None;
    for c in candidates {
        if !c.exists() {
            continue;
        }
        let name_key = read_cached(file_cache, &c)
            .and_then(|rec| rec.get("_RecordValue_"))
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(nk) = name_key {
            if let Some(ini) = ini {
                let stripped = nk.strip_prefix('@').unwrap_or(&nk).to_lowercase();
                resolved = ini.get(&stripped).cloned();
            }
            break;
        }
    }
    body_cache.insert(key, resolved.clone());
    resolved
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MiningSyncResult {
    pub rows_written: i64,
    pub distinct_resources: i64,
    pub distinct_bodies: i64,
    pub providers_seen: i64,
    pub errors: i64,
}

pub(crate) struct MiningRow {
    pub(crate) stem: String,
    pub(crate) rref: String,
    pub(crate) system: String,
    pub(crate) body: String,
    pub(crate) body_name: Option<String>,
    pub(crate) method: &'static str,
    pub(crate) rarity: Option<String>,
}

/// Peuple ResourceMiningLocation depuis mining_dump (clear-then-recreate, idempotent).
pub async fn sync_mining_locations_core(app: &AppHandle, dump_dir: &str) -> Result<MiningSyncResult, String> {
    let mut res = MiningSyncResult::default();
    let mining_root = Path::new(dump_dir).join("mining_dump");
    let providers_dir = mining_root
        .join("libs").join("foundry").join("records").join("harvestable").join("providerpresets");
    if !providers_dir.is_dir() {
        return Err(format!("providerpresets introuvable : {}", providers_dir.display()));
    }
    let ini_path = Path::new(dump_dir).join("Data").join("Localization").join("english").join("global.ini");
    let lower_ini = load_lower_ini(&ini_path);

    let mut file_cache: HashMap<PathBuf, Option<Value>> = HashMap::new();
    let mut body_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rows: Vec<MiningRow> = Vec::new();

    for provider_path in walk_json(&providers_dir) {
        res.providers_seen += 1;
        let Some((system, body)) = loc_from_provider(&provider_path) else { continue };
        // Extrait les groupes (clone) puis relâche le borrow du cache.
        let groups: Vec<Value> = {
            let Some(prov) = read_cached(&mut file_cache, &provider_path) else { continue };
            prov.get("_RecordValue_")
                .and_then(|v| v.get("harvestableGroups"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        };
        if groups.is_empty() {
            continue;
        }
        let body_name = resolve_body_name(&mining_root, lower_ini.as_ref(), &system, &body, &mut body_cache, &mut file_cache);

        for g in &groups {
            let Some(method) = g.get("groupName").and_then(|v| v.as_str()).and_then(group_to_method) else {
                continue;
            };
            let harvestables = g.get("harvestables").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            for el in &harvestables {
                let Some(hurl) = el.get("harvestable").and_then(|v| v.as_str()) else { continue };
                let Some(preset_path) = dump_path(hurl, &mining_root) else { continue };
                let rarity = rarity_from_preset(&preset_path);
                let entity_class: Option<String> = {
                    let Some(preset) = read_cached(&mut file_cache, &preset_path) else { continue };
                    preset.get("_RecordValue_").and_then(|v| v.get("entityClass")).and_then(|v| v.as_str()).map(|s| s.to_string())
                };
                let Some(entity_class) = entity_class else { continue };
                let Some(entity_path) = dump_path(&entity_class, &mining_root) else { continue };
                let comp_url: Option<String> = {
                    let Some(entity) = read_cached(&mut file_cache, &entity_path) else { continue };
                    entity
                        .get("_RecordValue_")
                        .and_then(|v| v.get("Components"))
                        .and_then(|v| v.as_array())
                        .and_then(|comps| {
                            comps.iter().find(|c| c.get("_Type_").and_then(|t| t.as_str()) == Some("MineableParams"))
                        })
                        .and_then(|c| c.get("composition"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                };
                let Some(comp_url) = comp_url else { continue };
                let Some(comp_path) = dump_path(&comp_url, &mining_root) else { continue };
                let parts: Vec<Value> = {
                    let Some(comp) = read_cached(&mut file_cache, &comp_path) else { continue };
                    comp.get("_RecordValue_").and_then(|v| v.get("compositionArray")).and_then(|v| v.as_array()).cloned().unwrap_or_default()
                };
                for part in &parts {
                    let Some(murl) = part.get("mineableElement").and_then(|v| v.as_str()) else { continue };
                    let Some(el_path) = dump_path(murl, &mining_root) else { continue };
                    let rrn: Option<String> = {
                        let Some(elem) = read_cached(&mut file_cache, &el_path) else { continue };
                        elem.get("_RecordValue_")
                            .and_then(|v| v.get("resourceType"))
                            .and_then(|v| v.get("_RecordName_"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    };
                    let Some(rrn) = rrn else { continue };
                    let rref = rrn.strip_prefix("ResourceType.").unwrap_or(&rrn).to_string();
                    let stem = apply_stem_alias(&normalise_to_stem(&rrn));
                    let key = format!("{stem}|{body}|{method}");
                    if !seen.insert(key) {
                        continue;
                    }
                    rows.push(MiningRow {
                        stem,
                        rref,
                        system: system.clone(),
                        body: body.clone(),
                        body_name: body_name.clone(),
                        method,
                        rarity: rarity.clone(),
                    });
                }
            }
        }
    }

    // Écriture : clear-then-recreate (idempotent, dedup en mémoire).
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    sqlx::query("DELETE FROM ResourceMiningLocation")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut resources: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut bodies: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in &rows {
        resources.insert(r.stem.clone());
        bodies.insert(format!("{}/{}", r.system, r.body));
        match sqlx::query(
            "INSERT INTO ResourceMiningLocation
               (resourceStem, resourceRef, systemName, rawBodyKey, bodyName, miningMethod, rarity, source, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'datamining', datetime('now'))",
        )
        .bind(&r.stem)
        .bind(&r.rref)
        .bind(&r.system)
        .bind(&r.body)
        .bind(&r.body_name)
        .bind(r.method)
        .bind(&r.rarity)
        .execute(pool)
        .await
        {
            Ok(_) => res.rows_written += 1,
            Err(e) => {
                res.errors += 1;
                if res.errors <= 5 {
                    eprintln!("[datamining] INSERT minage échoué (rref {:?}) : {e}", r.rref);
                }
            }
        }
    }
    res.distinct_resources = resources.len() as i64;
    res.distinct_bodies = bodies.len() as i64;

    eprintln!(
        "[datamining] OÙ MINER — {} localisations écrites, {} minerais, {} corps, {} providers, {} erreurs",
        res.rows_written, res.distinct_resources, res.distinct_bodies, res.providers_seen, res.errors
    );
    Ok(res)
}
