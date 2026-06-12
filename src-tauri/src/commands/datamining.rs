// Datamining V2 — enrichissement des stats de craft (producedItemStatsJson).
// Port Rust fidèle de la chaîne V1 (blueprintStatsEnricher.ts + craftingStatsTable.ts
// + globalIniParser.ts + index scitem). Lit les DUMPS DÉJÀ EXTRAITS (copie stable),
// PAS de StarBreaker ni de Data.p4k.
//
// Clé de jointure confirmée : blueprint._RecordId_ (dump) == uuid API == CraftingBlueprint.id.
// Échantillon de contrôle : SureStop S03, gpp_shield_maxhealth → baseValue 105600.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
// Copie stable des dumps (cf. étape de mise en sécurité). Configurable ici.
const STABLE_DUMP_DIR: &str = r"C:\Users\andre\Documents\scfleet-datamining-stable";

/* ─────────────────────────── Table GPP (24 entrées) ───────────────────────── */

#[derive(Clone)]
enum Resolver {
    None,
    Coolant,
    Power,
}
#[derive(Clone)]
struct Base {
    component_type: &'static str,
    field_path: &'static str,
    resolver: Resolver,
}
struct Entry {
    mode: &'static str, // "absolute" | "percent"
    stat_name: String,
    unit: &'static str,
    transform: &'static str,
    scale: f64,
    base: Option<Base>,
}

fn abs(stat: &str, unit: &'static str, transform: &'static str, scale: f64, base: Option<Base>) -> Entry {
    Entry { mode: "absolute", stat_name: stat.to_string(), unit, transform, scale, base }
}
fn pct(stat: &str, unit: &'static str, transform: &'static str) -> Entry {
    Entry { mode: "percent", stat_name: stat.to_string(), unit, transform, scale: 1.0, base: None }
}
fn fbase(ct: &'static str, fp: &'static str) -> Option<Base> {
    Some(Base { component_type: ct, field_path: fp, resolver: Resolver::None })
}

/// Mapping gpp → métadonnées stat. Inconnu → fallback percent (jamais d'absolu fabriqué).
fn gpp_entry(gpp: &str) -> Entry {
    match gpp {
        // ── Absolu (14) ──
        "gpp_shield_maxhealth" => abs("@StatName_GPP_Shield_MaxHealth", "@LOC_EMPTY", "none", 1.0, fbase("SCItemShieldGeneratorParams", "MaxShieldHealth")),
        "gpp_health_maxhealth" => abs("@StatName_GPP_Health_MaxHealth", "@LOC_EMPTY", "none", 1.0, fbase("SHealthComponentParams", "Health")),
        "gpp_armor_temperaturemin" => abs("@StatName_GPP_Armor_TemperatureMin", "@StatUnits_Temperature", "none", 1.0, fbase("SCItemClothingTemperatureResistanceParams", "MinResistance")),
        "gpp_armor_temperaturemax" => abs("@StatName_GPP_Armor_TemperatureMax", "@StatUnits_Temperature", "none", 1.0, fbase("SCItemClothingTemperatureResistanceParams", "MaxResistance")),
        "gpp_armor_radiationdissipation" => abs("@StatName_GPP_Armor_RadiationDissipation", "@StatUnits_RadiationDissipation", "none", 1.0, fbase("SCItemClothingRadiationResistanceParams", "RadiationDissipationRate")),
        "gpp_radar_minaimassistdistance" => abs("@StatName_GPP_Radar_MinAimAssistDistance", "@StatUnits_Meters", "none", 1.0, fbase("SCItemRadarComponentParams", "aimAssist.distanceMinAssignment")),
        "gpp_radar_maxaimassistdistance" => abs("@StatName_GPP_Radar_MaxAimAssistDistance", "@StatUnits_Meters", "none", 1.0, fbase("SCItemRadarComponentParams", "aimAssist.distanceMaxAssignment")),
        "gpp_weapon_tractor_force" => abs("@ui_weapons_tractor_BeamForce", "@LOC_EMPTY", "none", 1.0, fbase("SWeaponActionFireTractorBeamParams", "maxForce")),
        "gpp_weapon_tractor_fullstrengthdist" => abs("@StatName_GPP_Tractor_FullStrengthDistance", "@StatUnits_Meters", "none", 1.0, fbase("SWeaponActionFireTractorBeamParams", "fullStrengthDistance")),
        "gpp_weapon_tractor_maxdist" => abs("@StatName_GPP_Tractor_MaxDistance", "@StatUnits_Meters", "none", 1.0, fbase("SWeaponActionFireTractorBeamParams", "maxDistance")),
        "gpp_weapon_tractor_maxvolume" => abs("@StatName_GPP_Tractor_MaxVolume", "@StatUnits_Rating", "Scale", 0.0001, fbase("SWeaponActionFireTractorBeamParams", "maxVolume")),
        "gpp_itemresource_coolantgeneration" => abs("@StatName_GPP_ItemResource_CoolantGeneration", "@LOC_EMPTY", "none", 1.0, Some(Base { component_type: "*", field_path: "generation.resourceAmountPerSecond.standardResourceUnits", resolver: Resolver::Coolant })),
        "gpp_itemresource_powergeneration" => abs("@StatName_GPP_ItemResource_PowerGeneration", "@LOC_EMPTY", "none", 1.0, Some(Base { component_type: "*", field_path: "generation.resourceAmountPerSecond.units", resolver: Resolver::Power })),
        "gpp_quantum_speed" => abs("@StatName_GPP_Quantum_Speed", "@StatUnit_MmPerSec", "Scale", 1e-6, fbase("SCItemQuantumDriveParams", "params.driveSpeed")),
        // ── Percent (10) ──
        "gpp_weapon_damage" => pct("@StatName_GPP_Weapon_Damage", "@StatUnits_Percent", "Sequence_DamageEquivalentToPercentChange"),
        "gpp_weapon_recoil_kick" => pct("@StatName_GPP_Weapon_Recoil_Kick", "@StatUnits_Percent", "ConvertFactorToPercentChange"),
        "gpp_weapon_recoil_handling" => pct("@StatName_GPP_Weapon_Recoil_Handling", "@StatUnits_Percent", "ConvertFactorToNegatedPercentChange"),
        "gpp_weapon_recoil_smoothness" => pct("@StatName_GPP_Weapon_Recoil_Smoothness", "@StatUnits_Percent", "ConvertFactorToNegatedPercentChange"),
        "gpp_weapon_firerate" => pct("@StatName_GPP_Weapon_FireRate", "@StatUnits_RPM", "ConvertFactorToPercentChange"),
        "gpp_armor_damagemitigation" => pct("@StatName_GPP_Armor_DamageMitigation", "@LOC_EMPTY", "ConvertFactorToPercentChange"),
        "gpp_quantum_fuelrequirement" => pct("@StatName_GPP_Quantum_FuelRequirement", "@StatUnits_PerKm", "ConvertFactorToPercentChange"),
        "gpp_weapon_hullscraping_efficiency" => pct("@StatName_GPP_HullScraping_Efficiency", "@LOC_EMPTY", "ConvertFactorToPercentChange"),
        "gpp_weapon_hullscraping_radius" => pct("@StatName_GPP_HullScraping_Radius", "@LOC_EMPTY", "ConvertFactorToPercentChange"),
        "gpp_weapon_hullscraping_speed" => pct("@StatName_GPP_HullScraping_Speed", "@LOC_EMPTY", "ConvertFactorToPercentChange"),
        // ── Inconnu → percent ──
        _ => Entry { mode: "percent", stat_name: format!("@StatName_{gpp}"), unit: "@LOC_EMPTY", transform: "ConvertFactorToPercentChange", scale: 1.0, base: None },
    }
}

/* ──────────────────────────── Parcours de fichiers ────────────────────────── */

fn walk_json(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("json")).unwrap_or(false) {
                out.push(p);
            }
        }
    }
    out
}

/// Index scitem : basename minuscule (sans .json, garde _scitem) → chemin.
fn build_scitem_index(scitem_dir: &Path) -> HashMap<String, PathBuf> {
    let mut m = HashMap::new();
    for p in walk_json(scitem_dir) {
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            m.insert(stem.to_lowercase(), p);
        }
    }
    m
}

fn scitem_stem_from_entity_class(ec: &str) -> String {
    let base = ec.rsplit('/').next().unwrap_or("");
    let base = if base.to_lowercase().ends_with(".json") { &base[..base.len() - 5] } else { base };
    base.to_lowercase()
}

/* ────────────────────────── Collecte des modificateurs ─────────────────────── */

struct Collected {
    slot_debug: Option<String>,
    slot_display: Option<String>,
    gpp: String,
    ranges: Vec<[f64; 4]>, // [startQuality, endQuality, modifierAtStart, modifierAtEnd]
}

fn collect_modifiers(doc: &Value) -> Vec<Collected> {
    let mut out = Vec::new();
    visit_modifiers(doc, None, None, &mut out);
    out
}

fn visit_modifiers(node: &Value, slot_debug: Option<&str>, slot_display: Option<&str>, out: &mut Vec<Collected>) {
    match node {
        Value::Array(a) => {
            for v in a {
                visit_modifiers(v, slot_debug, slot_display, out);
            }
        }
        Value::Object(o) => {
            // Slot hérité de ce nœud (nameInfo) → passé aux enfants.
            let mut next_debug = slot_debug.map(|s| s.to_string());
            let mut next_display = slot_display.map(|s| s.to_string());
            if let Some(ni) = o.get("nameInfo").and_then(|v| v.as_object()) {
                let d = ni.get("debugName").and_then(|v| v.as_str());
                let dp = ni.get("displayName").and_then(|v| v.as_str());
                if d.is_some() || dp.is_some() {
                    next_debug = d.map(|s| s.to_string());
                    next_display = dp.map(|s| s.to_string());
                }
            }
            // Ce nœud est-il un modificateur ? (capturé sous le slot COURANT, pas next).
            if let Some(t) = o.get("_Type_").and_then(|v| v.as_str()) {
                if t.starts_with("CraftingGameplayPropertyModifier") {
                    if let Some(rec) = o.get("gameplayPropertyRecord").and_then(|v| v.as_str()) {
                        let base = rec.rsplit('/').next().unwrap_or("").to_lowercase();
                        let gpp = base.trim_end_matches(".json").to_string();
                        let mut ranges = Vec::new();
                        if let Some(arr) = o.get("valueRanges").and_then(|v| v.as_array()) {
                            for r in arr {
                                if let Some(ro) = r.as_object() {
                                    let sq = ro.get("startQuality").and_then(|v| v.as_f64());
                                    let eq = ro.get("endQuality").and_then(|v| v.as_f64());
                                    let ms = ro.get("modifierAtStart").and_then(|v| v.as_f64());
                                    let me = ro.get("modifierAtEnd").and_then(|v| v.as_f64());
                                    if let (Some(sq), Some(eq), Some(ms), Some(me)) = (sq, eq, ms, me) {
                                        ranges.push([sq, eq, ms, me]);
                                    }
                                }
                            }
                        }
                        if !gpp.is_empty() && !ranges.is_empty() {
                            out.push(Collected {
                                slot_debug: slot_debug.map(|s| s.to_string()),
                                slot_display: slot_display.map(|s| s.to_string()),
                                gpp,
                                ranges,
                            });
                        }
                    }
                }
            }
            for v in o.values() {
                visit_modifiers(v, next_debug.as_deref(), next_display.as_deref(), out);
            }
        }
        _ => {}
    }
}

/* ──────────────────────── Résolution baseValue (scitem) ────────────────────── */

/// DFS : 1er nœud `_Type_ === comp_type`, puis traverse fieldPath (segments numériques
/// = index de tableau). Renvoie le nombre feuille, sinon None (continue la recherche).
fn resolve_by_component_field(doc: &Value, comp_type: &str, field_path: &str) -> Option<f64> {
    let mut stack: Vec<&Value> = vec![doc];
    while let Some(node) = stack.pop() {
        match node {
            Value::Array(a) => {
                for v in a.iter().rev() {
                    stack.push(v);
                }
            }
            Value::Object(o) => {
                if o.get("_Type_").and_then(|v| v.as_str()) == Some(comp_type) {
                    let mut cursor: Option<&Value> = Some(node);
                    for seg in field_path.split('.') {
                        let Some(cur) = cursor else { break };
                        if !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()) {
                            cursor = cur.as_array().and_then(|arr| seg.parse::<usize>().ok().and_then(|i| arr.get(i)));
                        } else {
                            cursor = cur.as_object().and_then(|ob| ob.get(seg));
                        }
                    }
                    if let Some(v) = cursor.and_then(|c| c.as_f64()) {
                        return Some(v);
                    }
                    // Type trouvé mais chemin non résolu → continue (autre instance possible).
                }
                for v in o.values() {
                    if v.is_object() || v.is_array() {
                        stack.push(v);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Deep-walk cooler/powerplant : ItemResourceDelta{Generation,Conversion} dont
/// generation.resource === target, priorité état Online > On > autre.
fn resolve_resource_online(doc: &Value, target: &str, leaf: &str) -> Option<f64> {
    let mut best: Option<(u8, f64)> = None;
    visit_resource(doc, None, target, leaf, &mut best);
    best.map(|(_, v)| v)
}

fn visit_resource(node: &Value, state: Option<&str>, target: &str, leaf: &str, best: &mut Option<(u8, f64)>) {
    match node {
        Value::Array(a) => {
            for v in a {
                visit_resource(v, state, target, leaf, best);
            }
        }
        Value::Object(o) => {
            let new_state = o.get("name").and_then(|v| v.as_str()).or(state);
            let t = o.get("_Type_").and_then(|v| v.as_str());
            if t == Some("ItemResourceDeltaGeneration") || t == Some("ItemResourceDeltaConversion") {
                if let Some(gen) = o.get("generation").and_then(|v| v.as_object()) {
                    if gen.get("resource").and_then(|v| v.as_str()) == Some(target) {
                        if let Some(val) = gen
                            .get("resourceAmountPerSecond")
                            .and_then(|v| v.as_object())
                            .and_then(|aps| aps.get(leaf))
                            .and_then(|v| v.as_f64())
                        {
                            let pri = match new_state {
                                Some("Online") => 3,
                                Some("On") => 2,
                                _ => 1,
                            };
                            if best.map(|(p, _)| pri > p).unwrap_or(true) {
                                *best = Some((pri, val));
                            }
                        }
                    }
                }
            }
            for v in o.values() {
                visit_resource(v, new_state, target, leaf, best);
            }
        }
        _ => {}
    }
}

/* ───────────────────────────── global.ini (labels) ────────────────────────── */

fn load_lower_ini(ini_path: &Path) -> Option<HashMap<String, String>> {
    let content = fs::read_to_string(ini_path).ok()?;
    let mut m = HashMap::new();
    for raw in content.lines() {
        let line = raw.trim_start();
        if line.is_empty() {
            continue;
        }
        if let Some(eq) = line.find('=') {
            if eq == 0 {
                continue;
            }
            let key = line[..eq].trim_end().to_lowercase();
            let value = &line[eq + 1..];
            if !key.is_empty() {
                m.insert(key, value.to_string());
            }
        }
    }
    Some(m)
}

/// Résout une clé de loc (@…) : direct minuscule → variante `,p` → clé brute → fallback.
fn resolve_loc(key: &str, ini: Option<&HashMap<String, String>>) -> String {
    let Some(ini) = ini else { return key.to_string() };
    let stripped = key.strip_prefix('@').unwrap_or(key);
    if stripped.is_empty() {
        return key.to_string();
    }
    let lower = stripped.to_lowercase();
    if let Some(v) = ini.get(&lower) {
        return v.clone();
    }
    if let Some(v) = ini.get(&format!("{lower},p")) {
        return v.clone();
    }
    if let Some(v) = ini.get(stripped) {
        return v.clone();
    }
    key.to_string()
}

/* ──────────────────────────────── Résultat ────────────────────────────────── */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsEnrichResult {
    pub blueprints_scanned: i64,
    pub blueprints_with_stats: i64,
    pub blueprints_without_stats: i64,
    pub stats_written: i64,
    pub db_row_missing: i64,
    pub distinct_gpps: i64,
    pub sample_sure_stop_shield_hp: Option<f64>,
    pub errors: i64,
}

/* ──────────────────────────────── Cœur ────────────────────────────────────── */

/// Enrichit producedItemStatsJson pour tous les blueprints depuis un dossier de dumps.
/// Best-effort : un dump absent / blueprint sans bloc GPP n'est pas une erreur.
pub async fn enrich_blueprint_stats_core(app: &AppHandle, dump_dir: &str) -> Result<StatsEnrichResult, String> {
    let mut res = StatsEnrichResult::default();
    let root = Path::new(dump_dir);
    let bp_dir = root.join("blueprints_dump");
    let scitem_dir = root.join("scitem_dump");
    let ini_path = root.join("Data").join("Localization").join("english").join("global.ini");

    if !bp_dir.is_dir() {
        return Err(format!("blueprints_dump introuvable : {}", bp_dir.display()));
    }

    let lower_ini = load_lower_ini(&ini_path);
    let scitem_index = build_scitem_index(&scitem_dir);
    eprintln!(
        "[datamining] index scitem : {} entrées | global.ini : {}",
        scitem_index.len(),
        lower_ini.as_ref().map(|m| m.len()).unwrap_or(0)
    );

    // Pool DB.
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let mut scitem_cache: HashMap<PathBuf, Option<Value>> = HashMap::new();
    let mut distinct_gpps: std::collections::HashSet<String> = std::collections::HashSet::new();

    for bp_path in walk_json(&bp_dir) {
        res.blueprints_scanned += 1;
        let Ok(text) = fs::read_to_string(&bp_path) else {
            res.errors += 1;
            continue;
        };
        let Ok(doc) = serde_json::from_str::<Value>(&text) else {
            res.errors += 1;
            continue;
        };

        let blocks = collect_modifiers(&doc);
        if blocks.is_empty() {
            res.blueprints_without_stats += 1;
            continue;
        }
        res.blueprints_with_stats += 1;

        let Some(record_id) = doc.get("_RecordId_").and_then(|v| v.as_str()) else {
            continue;
        };
        let record_name = doc.get("_RecordName_").and_then(|v| v.as_str()).unwrap_or("");
        let entity_class = doc
            .get("_RecordValue_")
            .and_then(|v| v.get("blueprint"))
            .and_then(|v| v.get("processSpecificData"))
            .and_then(|v| v.get("entityClass"))
            .and_then(|v| v.as_str());

        // scitem du producteur (lazy + cache).
        let scitem_doc: Option<&Value> = if let Some(ec) = entity_class {
            let stem = scitem_stem_from_entity_class(ec);
            if let Some(path) = scitem_index.get(&stem) {
                let entry = scitem_cache.entry(path.clone()).or_insert_with(|| {
                    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
                });
                entry.as_ref()
            } else {
                None
            }
        } else {
            None
        };

        let mut base_cache: HashMap<String, Option<f64>> = HashMap::new();
        let mut persisted: Vec<Value> = Vec::new();

        for b in &blocks {
            distinct_gpps.insert(b.gpp.clone());
            let entry = gpp_entry(&b.gpp);

            // baseValue (absolu uniquement), avec dégradation en percent si introuvable.
            let mut mode = entry.mode;
            let mut base_value: Option<f64> = None;
            if entry.mode == "absolute" {
                if let Some(base) = &entry.base {
                    let v = if let Some(c) = base_cache.get(&b.gpp) {
                        *c
                    } else {
                        let resolved = scitem_doc.and_then(|d| match base.resolver {
                            Resolver::Coolant => resolve_resource_online(d, "Coolant", "standardResourceUnits"),
                            Resolver::Power => resolve_resource_online(d, "Power", "units"),
                            Resolver::None => resolve_by_component_field(d, base.component_type, base.field_path),
                        });
                        base_cache.insert(b.gpp.clone(), resolved);
                        resolved
                    };
                    match v {
                        Some(val) => base_value = Some(val),
                        None => mode = "percent", // dégradé
                    }
                }
            }

            let stat_name = resolve_loc(&entry.stat_name, lower_ini.as_ref());
            let unit = resolve_loc(entry.unit, lower_ini.as_ref());
            let slot_name = {
                let resolved = b.slot_display.as_deref().map(|d| resolve_loc(d, lower_ini.as_ref()));
                match resolved {
                    Some(r) if !r.starts_with('@') => r,
                    _ => b.slot_debug.clone().unwrap_or_else(|| "(slot)".to_string()),
                }
            };

            // Échantillon de contrôle.
            if b.gpp == "gpp_shield_maxhealth"
                && base_value.is_some()
                && record_name.to_lowercase().contains("surestop")
                && res.sample_sure_stop_shield_hp.is_none()
            {
                res.sample_sure_stop_shield_hp = base_value;
            }

            let ranges: Vec<Value> = b
                .ranges
                .iter()
                .map(|r| json!({ "startQuality": r[0], "endQuality": r[1], "modifierAtStart": r[2], "modifierAtEnd": r[3] }))
                .collect();

            persisted.push(json!({
                "slotName": slot_name,
                "slotDebugName": b.slot_debug,
                "gpp": b.gpp,
                "statNameLocKey": stat_name,
                "unitLocKey": unit,
                "mode": mode,
                "baseValue": base_value,
                "scale": entry.scale,
                "transformType": entry.transform,
                "valueRanges": ranges,
            }));
        }

        if persisted.is_empty() {
            continue;
        }

        let stats_json = serde_json::to_string(&persisted).unwrap_or_else(|_| "[]".to_string());
        match sqlx::query("UPDATE CraftingBlueprint SET producedItemStatsJson = ? WHERE id = ?")
            .bind(&stats_json)
            .bind(record_id)
            .execute(pool)
            .await
        {
            Ok(r) => {
                if r.rows_affected() == 0 {
                    res.db_row_missing += 1;
                } else {
                    res.stats_written += 1;
                }
            }
            Err(_) => res.errors += 1,
        }
    }

    res.distinct_gpps = distinct_gpps.len() as i64;
    eprintln!(
        "[datamining] STATS DE CRAFT — scannés: {}, avec stats: {}, sans: {}, écrits: {}, id absent en DB: {}, gpp distincts: {}, erreurs: {} | SureStop shield_maxhealth = {:?}",
        res.blueprints_scanned,
        res.blueprints_with_stats,
        res.blueprints_without_stats,
        res.stats_written,
        res.db_row_missing,
        res.distinct_gpps,
        res.errors,
        res.sample_sure_stop_shield_hp,
    );
    Ok(res)
}

/// Commande exposée : enrichit depuis la copie stable des dumps.
#[tauri::command]
pub async fn enrich_blueprint_stats(app: AppHandle) -> Result<StatsEnrichResult, String> {
    enrich_blueprint_stats_core(&app, STABLE_DUMP_DIR).await
}
