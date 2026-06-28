// Datamining V2 — enrichissement des stats de craft (producedItemStatsJson).
// Port Rust fidèle de la chaîne V1 (blueprintStatsEnricher.ts + craftingStatsTable.ts
// + globalIniParser.ts + index scitem). Lit les DUMPS DÉJÀ EXTRAITS (copie stable),
// PAS de StarBreaker ni de Data.p4k.
//
// Clé de jointure confirmée : blueprint._RecordId_ (dump) == uuid API == CraftingBlueprint.id.
// Échantillon de contrôle : SureStop S03, gpp_shield_maxhealth → baseValue 105600.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
// Repli : copie stable des dumps (machine de dev). Utilisé seulement si aucune extraction
// récente n'a laissé de dossier exploitable (cf. resolve_dump_dir).
const STABLE_DUMP_DIR: &str = r"C:\Users\andre\Documents\scfleet-datamining-stable";
// Clé AppMeta où l'extraction enregistre le dossier de dumps réellement produit.
const DUMP_DIR_KEY: &str = "datamining.dumpDir";

/// Lit une valeur AppMeta (None si absente/vide).
async fn read_app_meta(app: &AppHandle, key: &str) -> Option<String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL)?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return None,
    };
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .filter(|s| !s.trim().is_empty())
}

/// Dossier de dumps à utiliser pour l'apply : la SORTIE RÉELLE de la dernière extraction
/// (AppMeta `datamining.dumpDir`) si elle existe encore sur disque, sinon repli sur la copie
/// stable de dev. → l'enrichissement n'est plus lié à un chemin codé en dur.
async fn resolve_dump_dir(app: &AppHandle) -> String {
    if let Some(dir) = read_app_meta(app, DUMP_DIR_KEY).await {
        if Path::new(&dir).join("blueprints_dump").is_dir() {
            return dir;
        }
    }
    STABLE_DUMP_DIR.to_string()
}

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
            Err(e) => {
                res.errors += 1;
                if res.errors <= 5 {
                    eprintln!("[datamining] UPDATE stats blueprint #{record_id} échoué : {e}");
                }
            }
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
    let dir = resolve_dump_dir(&app).await;
    enrich_blueprint_stats_core(&app, &dir).await
}

/* ════════════ Backfill des noms FR de blueprint (producedItemNameFr) ══════════ */
// Partie (a) du re-cochage FR : peuple producedItemNameFr (colonne vide en V2).
// Chaîne : blueprint dump → entityClass → scitem → "Localization.Name" (@item_Name…)
// → résolution dans Data/Localization/french_(france)/global.ini.
// Passe SÉPARÉE de l'enrich des stats : couvre TOUS les blueprints (l'enrich
// ignore ceux sans bloc de stats). Ne touche ni producedItemName (EN) ni les stats.
// Pas de traduction FR → producedItemNameFr laissé NULL (fallback EN géré au matching).

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FrNamesBackfillResult {
    pub blueprints_scanned: i64,
    pub entity_class_missing: i64,
    pub scitem_missing: i64,
    pub loc_key_missing: i64,
    pub fr_missing_translation: i64,
    pub fr_written: i64,
    pub db_row_missing: i64,
    pub errors: i64,
    pub fr_dir: String,
}

/// Cherche récursivement la 1re clé de loc de nom : un objet `Localization`
/// dont `Name` est une clé `@…`. Le chemin réel est variable
/// (`_RecordValue_.Components[N].AttachDef.Localization.Name`).
fn find_loc_name_key(v: &Value) -> Option<String> {
    match v {
        Value::Object(map) => {
            if let Some(loc) = map.get("Localization").and_then(|l| l.as_object()) {
                if let Some(name) = loc.get("Name").and_then(|n| n.as_str()) {
                    if name.starts_with('@') {
                        return Some(name.to_string());
                    }
                }
            }
            map.values().find_map(find_loc_name_key)
        }
        Value::Array(arr) => arr.iter().find_map(find_loc_name_key),
        _ => None,
    }
}

pub async fn backfill_blueprint_names_fr_core(
    app: &AppHandle,
    dump_dir: &str,
) -> Result<FrNamesBackfillResult, String> {
    let mut res = FrNamesBackfillResult::default();
    let root = Path::new(dump_dir);
    let bp_dir = root.join("blueprints_dump");
    let scitem_dir = root.join("scitem_dump");

    if !bp_dir.is_dir() {
        return Err(format!("blueprints_dump introuvable : {}", bp_dir.display()));
    }

    // Dossier FR : "french_(france)" (constaté sur disque), repli "french".
    // Si aucun n'a de global.ini → erreur explicite (on ne devine pas).
    let loc_root = root.join("Data").join("Localization");
    let fr_candidates = ["french_(france)", "french"];
    let Some((fr_dir, fr_ini_path)) = fr_candidates.iter().find_map(|name| {
        let p = loc_root.join(name).join("global.ini");
        if p.is_file() {
            Some((name.to_string(), p))
        } else {
            None
        }
    }) else {
        return Err(format!(
            "global.ini FR introuvable sous {} (essayé : {:?})",
            loc_root.display(),
            fr_candidates
        ));
    };
    res.fr_dir = fr_dir;

    let fr_ini = load_lower_ini(&fr_ini_path);
    let scitem_index = build_scitem_index(&scitem_dir);
    eprintln!(
        "[datamining] backfill FR : dossier '{}' | global.ini FR : {} entrées | scitem : {} entrées",
        res.fr_dir,
        fr_ini.as_ref().map(|m| m.len()).unwrap_or(0),
        scitem_index.len()
    );

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let mut scitem_cache: HashMap<PathBuf, Option<Value>> = HashMap::new();

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

        // Clé de jointure DB = _RecordId_ (== uuid API == CraftingBlueprint.id).
        let Some(record_id) = doc.get("_RecordId_").and_then(|v| v.as_str()) else {
            continue;
        };
        let entity_class = doc
            .get("_RecordValue_")
            .and_then(|v| v.get("blueprint"))
            .and_then(|v| v.get("processSpecificData"))
            .and_then(|v| v.get("entityClass"))
            .and_then(|v| v.as_str());
        let Some(ec) = entity_class else {
            res.entity_class_missing += 1;
            continue;
        };

        // scitem du producteur (lazy + cache).
        let stem = scitem_stem_from_entity_class(ec);
        let Some(path) = scitem_index.get(&stem) else {
            res.scitem_missing += 1;
            continue;
        };
        let entry = scitem_cache.entry(path.clone()).or_insert_with(|| {
            fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        });
        let Some(scitem_doc) = entry.as_ref() else {
            res.errors += 1;
            continue;
        };

        // Clé de loc du nom (@item_Name…) puis résolution FR.
        let Some(loc_key) = find_loc_name_key(scitem_doc) else {
            res.loc_key_missing += 1;
            continue;
        };
        let fr_name = resolve_loc(&loc_key, fr_ini.as_ref());
        // Pas de traduction FR → laisser NULL. Deux formes :
        //  - clé absente du global.ini FR : resolve_loc renvoie la clé brute (@…) ;
        //  - clé présente mais non traduite : valeur sentinelle
        //    "! FRENCH_(FRANCE) TRANSLATION NOT FOUND FOR LOCID: … !".
        if fr_name.starts_with('@')
            || fr_name.trim().is_empty()
            || fr_name.contains("TRANSLATION NOT FOUND")
        {
            res.fr_missing_translation += 1;
            continue;
        }

        match sqlx::query("UPDATE CraftingBlueprint SET producedItemNameFr = ? WHERE id = ?")
            .bind(&fr_name)
            .bind(record_id)
            .execute(pool)
            .await
        {
            Ok(r) => {
                if r.rows_affected() == 0 {
                    res.db_row_missing += 1;
                } else {
                    res.fr_written += 1;
                }
            }
            Err(e) => {
                res.errors += 1;
                if res.errors <= 5 {
                    eprintln!("[datamining] UPDATE nom FR blueprint #{record_id} échoué : {e}");
                }
            }
        }
    }

    eprintln!(
        "[datamining] backfill FR — scannés: {}, ec absent: {}, scitem absent: {}, clé loc absente: {}, sans trad FR: {}, écrits: {}, id absent DB: {}, erreurs: {}",
        res.blueprints_scanned,
        res.entity_class_missing,
        res.scitem_missing,
        res.loc_key_missing,
        res.fr_missing_translation,
        res.fr_written,
        res.db_row_missing,
        res.errors,
    );
    Ok(res)
}

/// Commande exposée : peuple producedItemNameFr depuis la copie stable des dumps.
#[tauri::command]
pub async fn backfill_blueprint_names_fr(app: AppHandle) -> Result<FrNamesBackfillResult, String> {
    let dir = resolve_dump_dir(&app).await;
    backfill_blueprint_names_fr_core(&app, &dir).await
}

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

fn group_to_method(g: &str) -> Option<&'static str> {
    match g.to_lowercase().as_str() {
        "fps_mineables" => Some("fps"),
        "groundvehicle_mineables" => Some("ground_vehicle"),
        "spaceship_mineables" => Some("ship"),
        _ => None,
    }
}

fn rarity_from_preset(p: &Path) -> Option<String> {
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
fn loc_from_provider(p: &Path) -> Option<(String, String)> {
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
fn dump_path(url: &str, root: &Path) -> Option<PathBuf> {
    let idx = url.find("libs/foundry/records/")?;
    Some(root.join(url[idx..].replace('/', std::path::MAIN_SEPARATOR_STR)))
}

/// Lit (avec cache) un JSON DataCore. None si illisible/invalide.
fn read_cached<'a>(cache: &'a mut HashMap<PathBuf, Option<Value>>, p: &Path) -> Option<&'a Value> {
    if !cache.contains_key(p) {
        let v = fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok());
        cache.insert(p.to_path_buf(), v);
    }
    cache.get(p).and_then(|o| o.as_ref())
}

/// Nom lisible du corps via starmap (loc key → global.ini). None si non résolu.
fn resolve_body_name(
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

struct MiningRow {
    stem: String,
    rref: String,
    system: String,
    body: String,
    body_name: Option<String>,
    method: &'static str,
    rarity: Option<String>,
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

/// Commande exposée : peuple ResourceMiningLocation depuis la copie stable.
#[tauri::command]
pub async fn sync_mining_locations(app: AppHandle) -> Result<MiningSyncResult, String> {
    let dir = resolve_dump_dir(&app).await;
    sync_mining_locations_core(&app, &dir).await
}

/* ════════════════════════ Starmap (StarmapBody) ═════════════════════════════ */
// Port Rust de starmapParser.ts (applyDataminingToStarmap, 2 passes). Source =
// mining_dump/libs/foundry/records/starmap/pu/system/{stanton,pyro,nyx}. PAS de coords
// (posX/Y/Z restent NULL, comme V1) — la carte est synthétisée côté renderer (lots front).

const STARMAP_SYSTEMS: [&str; 3] = ["stanton", "pyro", "nyx"];

fn kept_nav_icon(icon: &str) -> bool {
    matches!(
        icon,
        "Star" | "Planet" | "Moon" | "LandingZone" | "Station" | "Outpost" | "Lagrange"
    )
}

/// _L1.._L5 en fin de recordName (« Default » en source) → Lagrange, sinon navIcon brut.
fn classify_nav_icon(record_name: &str, raw: &str) -> String {
    let is_lagrange = ["_L1", "_L2", "_L3", "_L4", "_L5"].iter().any(|s| record_name.ends_with(s));
    if is_lagrange { "Lagrange".to_string() } else { raw.to_string() }
}

/// parentRef = dernier segment du basename du parent (sans .json).
fn extract_parent_ref(parent: Option<&str>) -> Option<String> {
    let p = parent?;
    let base = p.rsplit('/').next().unwrap_or(p);
    let base = base.strip_suffix(".json").unwrap_or(base);
    base.rsplit('.').next().map(|s| s.to_string())
}

/// orbitOrder = chiffres finaux du dernier segment du recordName ("Stanton1"→1, "Stanton1a"→null).
fn extract_orbit_order(record_name: &str) -> Option<i64> {
    let suffix = record_name.rsplit('.').next().unwrap_or(record_name);
    let digits: String = suffix
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if digits.is_empty() { None } else { digits.parse::<i64>().ok() }
}

/// Résout une clé loc (@…) en texte via global.ini minuscule. None si non résolu.
fn resolve_ini_opt(raw: &str, ini: Option<&HashMap<String, String>>) -> Option<String> {
    let ini = ini?;
    let stripped = raw.strip_prefix('@').unwrap_or(raw);
    ini.get(&stripped.to_lowercase()).cloned()
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StarmapSyncResult {
    pub bodies_written: i64,
    pub stanton: i64,
    pub pyro: i64,
    pub nyx: i64,
    pub names_resolved: i64,
    pub by_type: std::collections::BTreeMap<String, i64>,
    pub errors: i64,
}

struct ParsedBody {
    record_name: String,
    nav_icon: String,
    name: String,
    name_resolved: bool,
    description: Option<String>,
    size: Option<f64>,
    parent_ref: Option<String>,
    show_orbit: bool,
    hide: bool,
}

struct StarmapRow {
    record_name: String,
    system: String,
    nav_icon: String,
    name: String,
    name_resolved: bool,
    description: Option<String>,
    size: Option<f64>,
    parent_ref: Option<String>,
    show_orbit: bool,
    orbit_order: Option<i64>,
}

/// Peuple StarmapBody depuis les dumps (clear-then-recreate, idempotent). Best-effort.
pub async fn sync_starmap_core(app: &AppHandle, dump_dir: &str) -> Result<StarmapSyncResult, String> {
    let mut res = StarmapSyncResult::default();
    let base = Path::new(dump_dir)
        .join("mining_dump")
        .join("libs").join("foundry").join("records").join("starmap").join("pu").join("system");
    if !base.is_dir() {
        return Err(format!("starmap introuvable : {}", base.display()));
    }
    let ini_path = Path::new(dump_dir).join("Data").join("Localization").join("english").join("global.ini");
    let lower_ini = load_lower_ini(&ini_path);

    // (système, chemin) de tous les fichiers des 3 systèmes.
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for sys in STARMAP_SYSTEMS {
        let sys_dir = base.join(sys);
        for p in walk_json(&sys_dir) {
            files.push((sys.to_string(), p));
        }
    }

    let mut cache: HashMap<PathBuf, Option<Value>> = HashMap::new();

    // PASS 1 — index stem → navIcon effectif (règle planète-sous-planète).
    let mut nav_by_stem: HashMap<String, String> = HashMap::new();
    for (_sys, path) in &files {
        let (rn, ni) = {
            let Some(doc) = read_cached(&mut cache, path) else { continue };
            let rn = doc.get("_RecordName_").and_then(|v| v.as_str()).map(|s| s.to_string());
            let ni = doc
                .get("_RecordValue_")
                .and_then(|v| v.get("navIcon"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            (rn, ni)
        };
        if let Some(rn) = rn {
            if let Some(stem) = rn.rsplit('.').next() {
                nav_by_stem.insert(stem.to_lowercase(), classify_nav_icon(&rn, &ni));
            }
        }
    }

    // PASS 2 — construit les lignes (dédup par recordName).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rows: Vec<StarmapRow> = Vec::new();
    for (sys, path) in &files {
        // Extrait les champs (owned) puis relâche le borrow du cache.
        let parsed: Option<ParsedBody> = {
            match read_cached(&mut cache, path) {
                Some(doc) => {
                    let rn = doc.get("_RecordName_").and_then(|v| v.as_str());
                    let rv = doc.get("_RecordValue_");
                    match (rn, rv) {
                        (Some(rn), Some(rv)) => {
                            let raw_icon = rv.get("navIcon").and_then(|v| v.as_str()).unwrap_or("");
                            let raw_parent = rv.get("parent").and_then(|v| v.as_str());
                            let raw_name = rv.get("name").and_then(|v| v.as_str());
                            let raw_desc = rv.get("description").and_then(|v| v.as_str());
                            let name_res = raw_name.and_then(|n| resolve_ini_opt(n, lower_ini.as_ref()));
                            let name = name_res
                                .clone()
                                .or_else(|| raw_name.map(|s| s.to_string()))
                                .unwrap_or_else(|| rn.to_string());
                            Some(ParsedBody {
                                record_name: rn.to_string(),
                                nav_icon: classify_nav_icon(rn, raw_icon),
                                name,
                                name_resolved: name_res.is_some(),
                                description: raw_desc.and_then(|d| resolve_ini_opt(d, lower_ini.as_ref())),
                                size: rv.get("size").and_then(|v| v.as_f64()),
                                parent_ref: extract_parent_ref(raw_parent),
                                show_orbit: rv.get("showOrbitLine").and_then(|v| v.as_bool()).unwrap_or(false),
                                hide: rv.get("hideInStarmap").and_then(|v| v.as_bool()).unwrap_or(false),
                            })
                        }
                        _ => None,
                    }
                }
                None => None,
            }
        };
        let Some(p) = parsed else { continue };

        // Reclassement planète-sous-planète : Planet dont le parent est Planet → Moon.
        let mut nav_icon = p.nav_icon;
        let mut parent_ref = p.parent_ref.clone();
        if nav_icon == "Planet" {
            if let Some(ps) = p.parent_ref.as_ref().map(|s| s.to_lowercase()) {
                if nav_by_stem.get(&ps).map(|s| s == "Planet").unwrap_or(false) {
                    nav_icon = "Moon".to_string();
                    parent_ref = Some(ps);
                }
            }
        }

        if !kept_nav_icon(&nav_icon) || p.hide {
            continue;
        }
        if !seen.insert(p.record_name.clone()) {
            continue;
        }

        let orbit_order = extract_orbit_order(&p.record_name);
        rows.push(StarmapRow {
            record_name: p.record_name,
            system: sys.clone(),
            nav_icon,
            name: p.name,
            name_resolved: p.name_resolved,
            description: p.description,
            size: p.size,
            parent_ref,
            show_orbit: p.show_orbit,
            orbit_order,
        });
    }

    // Écriture : clear-then-recreate.
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Source-filtré : ne supprime QUE les lignes datamining → n'écrase jamais la carte Wiki
    // (source autoritaire de StarmapBody). Neutralise le « piège » d'effacement croisé.
    sqlx::query("DELETE FROM StarmapBody WHERE source = 'datamining'")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    for r in &rows {
        match sqlx::query(
            "INSERT INTO StarmapBody
               (id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'datamining', datetime('now'))",
        )
        .bind(&r.record_name) // id = recordName (déterministe, unique)
        .bind(&r.record_name)
        .bind(&r.system)
        .bind(&r.nav_icon)
        .bind(&r.name)
        .bind(&r.description)
        .bind(r.size)
        .bind(&r.parent_ref)
        .bind(i64::from(r.show_orbit))
        .bind(r.orbit_order)
        .execute(pool)
        .await
        {
            Ok(_) => {
                res.bodies_written += 1;
                match r.system.as_str() {
                    "stanton" => res.stanton += 1,
                    "pyro" => res.pyro += 1,
                    "nyx" => res.nyx += 1,
                    _ => {}
                }
                *res.by_type.entry(r.nav_icon.clone()).or_insert(0) += 1;
                if r.name_resolved {
                    res.names_resolved += 1;
                }
            }
            Err(e) => {
                res.errors += 1;
                if res.errors <= 5 {
                    eprintln!("[datamining] INSERT corps céleste échoué (record {:?}) : {e}", r.record_name);
                }
            }
        }
    }

    eprintln!(
        "[datamining] STARMAP — {} corps (Stanton {}, Pyro {}, Nyx {}) | types {:?} | noms résolus {} | erreurs {}",
        res.bodies_written, res.stanton, res.pyro, res.nyx, res.by_type, res.names_resolved, res.errors
    );
    Ok(res)
}

/// Commande exposée : peuple StarmapBody depuis la copie stable.
#[tauri::command]
pub async fn sync_starmap(app: AppHandle) -> Result<StarmapSyncResult, String> {
    let dir = resolve_dump_dir(&app).await;
    sync_starmap_core(&app, &dir).await
}

/* ──────────── STARMAP depuis les tables Wiki en base (Phase 1 + 2) ─────────── */
// Alimente StarmapBody depuis WikiLocationPosition + WikiStarmapLocation (peuplées
// par le Cargo, jointes par uuid). AUCUN réseau. Phase 2 : posX/Y/Z = coordonnées
// cartésiennes réelles (mètres, intra-système) → le renderer place les corps en
// log par niveau. La jointure parent↔enfant passe sur l'uuid (colonne wikiUuid) ;
// recordName porte un stem « legacy » qui pilote les couleurs/images côté front.

struct StarmapWikiRow {
    uuid: String,
    record_name: String,
    system: String,
    nav_icon: String,
    name: String,
    name_resolved: bool,
    parent_ref: Option<String>,
    show_orbit: bool,
    orbit_order: Option<i64>,
    pos_x: Option<f64>,
    pos_y: Option<f64>,
    pos_z: Option<f64>,
}

/// type (WikiLocationPosition) → navIcon StarmapBody. None = corps filtré
/// (astéroïdes, anomalies, jump points…) — MÊME set que le datamining pour ne pas
/// noyer la carte. Pas de Lagrange côté Wiki (absent des données).
fn wiki_nav_icon(type_: &str) -> Option<&'static str> {
    match type_ {
        "Star" => Some("Star"),
        "Planet" => Some("Planet"),
        "Moon" => Some("Moon"),
        "LandingZone" => Some("LandingZone"),
        _ if type_.starts_with("Manmade") => Some("Station"),
        _ if type_.starts_with("Outpost") => Some("Outpost"),
        _ => None,
    }
}

/// Dernier token d'une désignation en chiffre romain → entier
/// (ex. "Stanton II" → 2, "Manfred III" → 3). None si non parsable.
fn roman_to_int(s: &str) -> Option<i64> {
    let token = s.split_whitespace().last()?.to_uppercase();
    if token.is_empty() {
        return None;
    }
    let val = |c: char| match c {
        'I' => Some(1),
        'V' => Some(5),
        'X' => Some(10),
        'L' => Some(50),
        'C' => Some(100),
        'D' => Some(500),
        'M' => Some(1000),
        _ => None,
    };
    let digits: Vec<i64> = token.chars().map(val).collect::<Option<Vec<_>>>()?;
    let mut total = 0i64;
    for i in 0..digits.len() {
        if i + 1 < digits.len() && digits[i] < digits[i + 1] {
            total -= digits[i];
        } else {
            total += digits[i];
        }
    }
    Some(total)
}

/* ───────────────────── STARMAP via API RSI (sous-projet A) ───────────────────── */

/// type RSI → navIcon. Jumppoint/AsteroidBelt sont nouveaux (ignorés par la 2D, gérés par la 3D).
fn rsi_nav_icon(type_: &str) -> Option<&'static str> {
    match type_ {
        "STAR" => Some("Star"),
        "PLANET" => Some("Planet"),
        "SATELLITE" => Some("Moon"),
        "MANMADE" => Some("Station"),
        "JUMPPOINT" => Some("Jumppoint"),
        "ASTEROID_BELT" => Some("AsteroidBelt"),
        _ => None,
    }
}

pub struct StarmapRsiRow {
    pub id: String,
    pub wiki_uuid: String,
    pub record_name: String,
    pub system: String,
    pub nav_icon: String,
    pub name: String,
    pub description: Option<String>,
    pub subtype: Option<String>,
    pub appearance: Option<String>,
    pub aff_color: Option<String>,
    pub size: Option<f64>,
    pub distance: Option<f64>,
    pub longitude: Option<f64>,
    pub latitude: Option<f64>,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
    pub pos_z: Option<f64>,
    pub habitable: Option<i64>,
    pub orbit_order: Option<i64>,
    pub parent_ref: Option<String>,
    pub show_orbit: bool,
}

/// Vecteur local d'un objet depuis ses (distance, longitude, latitude).
fn rsi_local_pos(o: &serde_json::Value) -> (f64, f64, f64) {
    let d = o.get("distance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lon = o.get("longitude").and_then(|v| v.as_f64()).unwrap_or(0.0).to_radians();
    let lat = o.get("latitude").and_then(|v| v.as_f64()).unwrap_or(0.0).to_radians();
    (d * lon.cos() * lat.cos(), d * lon.sin() * lat.cos(), d * lat.sin())
}

/// Position ABSOLUE intra-système (résolution récursive parent + local, mémoïsée).
fn rsi_abs_pos(
    id: i64,
    by_id: &std::collections::HashMap<i64, serde_json::Value>,
    memo: &mut std::collections::HashMap<i64, (f64, f64, f64)>,
) -> (f64, f64, f64) {
    if let Some(p) = memo.get(&id) {
        return *p;
    }
    let o = match by_id.get(&id) {
        Some(o) => o,
        None => return (0.0, 0.0, 0.0),
    };
    let local = rsi_local_pos(o);
    let abs = match o.get("parent_id").and_then(|v| v.as_i64()) {
        Some(pid) => {
            let pp = rsi_abs_pos(pid, by_id, memo);
            (pp.0 + local.0, pp.1 + local.1, pp.2 + local.2)
        }
        None => local, // niveau étoile : local (l'étoile a distance 0 → origine)
    };
    memo.insert(id, abs);
    abs
}

/// Mapping pur RSI → lignes StarmapBody. Aucun réseau, aucune DB.
/// Garde-fou : JSON sans celestial_objects → Vec vide (l'appelant ne videra pas la table).
pub fn map_rsi_system(code: &str, json: &serde_json::Value) -> Vec<StarmapRsiRow> {
    let objs = json
        .get("data")
        .and_then(|v| v.get("resultset"))
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("celestial_objects"))
        .and_then(|v| v.as_array());
    let Some(objs) = objs else { return Vec::new() };

    let system = code.to_lowercase();
    let by_id: std::collections::HashMap<i64, serde_json::Value> = objs
        .iter()
        .filter_map(|o| o.get("id").and_then(|v| v.as_i64()).map(|id| (id, o.clone())))
        .collect();
    let mut memo = std::collections::HashMap::new();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rows = Vec::new();

    for o in objs {
        let Some(id) = o.get("id").and_then(|v| v.as_i64()) else { continue };
        let type_ = o.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let Some(nav_icon) = rsi_nav_icon(type_) else { continue };

        let designation = o.get("designation").and_then(|v| v.as_str()).map(str::to_string);
        let name = o
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| designation.clone())
            .unwrap_or_else(|| format!("rsi-{id}"));
        let orbit_order = designation.as_deref().and_then(roman_to_int);

        let mut record_name = match nav_icon {
            "Star" => format!("{system}star"),
            "Planet" => match orbit_order {
                Some(n) => format!("{system}{n}"),
                None => format!("rsi-{id}"),
            },
            _ => format!("rsi-{id}"),
        };
        if !used.insert(record_name.clone()) {
            record_name = format!("rsi-{id}");
            used.insert(record_name.clone());
        }

        let (px, py, pz) = rsi_abs_pos(id, &by_id, &mut memo);
        // aff_color : best-effort (affiliation au format tableau [{color}] ; sinon None).
        let aff_color = o
            .get("affiliation")
            .and_then(|a| a.get(0))
            .and_then(|a| a.get("color"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        rows.push(StarmapRsiRow {
            id: format!("rsi-{id}"),
            wiki_uuid: format!("rsi-{id}"),
            record_name,
            system: system.clone(),
            nav_icon: nav_icon.to_string(),
            name,
            description: o
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string),
            subtype: o
                .get("subtype")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            appearance: o
                .get("appearance")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty() && *s != "DEFAULT")
                .map(str::to_string),
            aff_color,
            size: o.get("size").and_then(|v| v.as_f64()),
            distance: o.get("distance").and_then(|v| v.as_f64()),
            longitude: o.get("longitude").and_then(|v| v.as_f64()),
            latitude: o.get("latitude").and_then(|v| v.as_f64()),
            pos_x: Some(px),
            pos_y: Some(py),
            pos_z: Some(pz),
            habitable: o.get("habitable").and_then(|v| v.as_bool()).map(i64::from),
            orbit_order,
            parent_ref: o.get("parent_id").and_then(|v| v.as_i64()).map(|p| format!("rsi-{p}")),
            show_orbit: matches!(nav_icon, "Planet" | "Moon" | "Station"),
        });
    }
    rows
}

/// Réécrit StarmapBody depuis des lignes RSI (transaction, clear-then-recreate).
/// Garde-fou : rows vide → la table n'est PAS touchée, renvoie Err.
pub async fn write_starmap_rows(
    pool: &sqlx::SqlitePool,
    rows: &[StarmapRsiRow],
) -> Result<StarmapSyncResult, String> {
    if rows.is_empty() {
        return Err("starmap RSI : 0 corps — StarmapBody conservé".into());
    }
    let mut res = StarmapSyncResult::default();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM StarmapBody").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    for r in rows {
        sqlx::query(
            "INSERT INTO StarmapBody
               (id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, wikiUuid,
                posX, posY, posZ, distance, longitude, latitude, subtype, appearance, habitable, affColor)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'rsi', datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&r.id)
        .bind(&r.record_name)
        .bind(&r.system)
        .bind(&r.nav_icon)
        .bind(&r.name)
        .bind(&r.description)
        .bind(r.size)
        .bind(&r.parent_ref)
        .bind(i64::from(r.show_orbit))
        .bind(r.orbit_order)
        .bind(&r.wiki_uuid)
        .bind(r.pos_x)
        .bind(r.pos_y)
        .bind(r.pos_z)
        .bind(r.distance)
        .bind(r.longitude)
        .bind(r.latitude)
        .bind(&r.subtype)
        .bind(&r.appearance)
        .bind(r.habitable)
        .bind(&r.aff_color)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        res.bodies_written += 1;
        match r.system.as_str() {
            "stanton" => res.stanton += 1,
            "pyro" => res.pyro += 1,
            "nyx" => res.nyx += 1,
            _ => {}
        }
        *res.by_type.entry(r.nav_icon.clone()).or_insert(0) += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(res)
}

/// Peuple StarmapBody depuis les tables Wiki déjà en base (sans réseau).
/// Garde-fou : si les sources sont vides, StarmapBody n'est PAS vidé.
pub async fn sync_starmap_from_wiki_core(app: &AppHandle) -> Result<StarmapSyncResult, String> {
    let mut res = StarmapSyncResult::default();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Squelette = positions (hiérarchie via parentUuid) + noms via locations (uuid).
    // Filtre dur : non cachés, uuid non vide, 3 systèmes cibles.
    let src = sqlx::query(
        "SELECT p.uuid AS uuid, p.parentUuid AS parentUuid, p.name AS posName,
                p.type AS ptype, p.systemName AS systemName, p.x AS px, p.y AS py, p.z AS pz,
                l.name AS locName, l.designation AS designation
         FROM WikiLocationPosition p
         LEFT JOIN WikiStarmapLocation l ON l.uuid = p.uuid
         WHERE p.hidden = 0 AND p.uuid <> ''
           AND p.systemName IN ('stanton','pyro','nyx')",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut rows: Vec<StarmapWikiRow> = Vec::new();
    let mut used_records: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in &src {
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        if uuid.is_empty() {
            continue;
        }
        let ptype: String = r.try_get("ptype").unwrap_or_default();
        let Some(nav_icon) = wiki_nav_icon(&ptype) else { continue };
        let system: String = r.try_get("systemName").unwrap_or_default();
        let parent_ref: Option<String> = r
            .try_get::<Option<String>, _>("parentUuid")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty());
        let loc_name: Option<String> = r.try_get::<Option<String>, _>("locName").ok().flatten();
        let pos_name: Option<String> = r.try_get::<Option<String>, _>("posName").ok().flatten();
        let designation: Option<String> = r.try_get::<Option<String>, _>("designation").ok().flatten();
        // Coordonnées cartésiennes réelles (mètres, intra-système) — Phase 2.
        let pos_x: Option<f64> = r.try_get::<Option<f64>, _>("px").ok().flatten();
        let pos_y: Option<f64> = r.try_get::<Option<f64>, _>("py").ok().flatten();
        let pos_z: Option<f64> = r.try_get::<Option<f64>, _>("pz").ok().flatten();

        // name : locations.name → positions.name → designation → uuid.
        let name = loc_name
            .clone()
            .or_else(|| pos_name.clone())
            .or_else(|| designation.clone())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| uuid.clone());
        let name_resolved = loc_name.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);

        // orbitOrder : chiffre romain de la désignation (planètes). None sinon.
        let orbit_order = designation.as_deref().and_then(roman_to_int);

        // recordName (stem) : pilote couleurs/images (bodyColor lit le stem).
        //   Étoile  → "{sys}star" (stantonstar…)
        //   Planète → "{sys}{n}"  (stanton2…) — n = chiffre romain
        //   Lune/POI → uuid (couleur via MOON_COLOR / type : stem inutile)
        let mut record_name = match nav_icon {
            "Star" => format!("{system}star"),
            "Planet" => match orbit_order {
                Some(n) => format!("{system}{n}"),
                None => uuid.clone(),
            },
            _ => uuid.clone(),
        };
        // Unicité (contrainte UNIQUE recordName) : collision improbable → uuid.
        if !used_records.insert(record_name.clone()) {
            record_name = uuid.clone();
            used_records.insert(record_name.clone());
        }

        // CORRECTION 1 — showOrbitLine : true pour Planet/Moon ET Station (orbitale,
        // rendue sur l'anneau au niveau sphère) ; false pour Outpost/LandingZone (sol).
        let show_orbit = matches!(nav_icon, "Planet" | "Moon" | "Station");

        rows.push(StarmapWikiRow {
            uuid,
            record_name,
            system,
            nav_icon: nav_icon.to_string(),
            name,
            name_resolved,
            parent_ref,
            show_orbit,
            orbit_order,
            pos_x,
            pos_y,
            pos_z,
        });
    }

    // Garde-fou : aucune source exploitable → on ne touche PAS StarmapBody.
    if rows.is_empty() {
        return Err(
            "starmap wiki : 0 corps (tables Wiki vides ou Cargo non synchronisé) — StarmapBody conservé"
                .into(),
        );
    }

    // Écriture : clear-then-recreate (idempotent), comme le datamining.
    sqlx::query("DELETE FROM StarmapBody")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    for r in &rows {
        match sqlx::query(
            "INSERT INTO StarmapBody
               (id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, wikiUuid,
                posX, posY, posZ)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, 'wiki', datetime('now'), ?, ?, ?, ?)",
        )
        .bind(&r.uuid) // id = uuid (déterministe, unique)
        .bind(&r.record_name)
        .bind(&r.system)
        .bind(&r.nav_icon)
        .bind(&r.name)
        .bind(&r.parent_ref)
        .bind(i64::from(r.show_orbit))
        .bind(r.orbit_order)
        .bind(&r.uuid) // wikiUuid = clé de jointure parent↔enfant côté renderer
        .bind(r.pos_x)
        .bind(r.pos_y)
        .bind(r.pos_z)
        .execute(pool)
        .await
        {
            Ok(_) => {
                res.bodies_written += 1;
                match r.system.as_str() {
                    "stanton" => res.stanton += 1,
                    "pyro" => res.pyro += 1,
                    "nyx" => res.nyx += 1,
                    _ => {}
                }
                *res.by_type.entry(r.nav_icon.clone()).or_insert(0) += 1;
                if r.name_resolved {
                    res.names_resolved += 1;
                }
            }
            Err(e) => {
                res.errors += 1;
                if res.errors <= 5 {
                    eprintln!("[starmap-wiki] INSERT corps céleste échoué (uuid {:?}) : {e}", r.uuid);
                }
            }
        }
    }

    eprintln!(
        "[starmap-wiki] STARMAP (Wiki) — {} corps (Stanton {}, Pyro {}, Nyx {}) | types {:?} | noms {} | erreurs {}",
        res.bodies_written, res.stanton, res.pyro, res.nyx, res.by_type, res.names_resolved, res.errors
    );
    Ok(res)
}

/// Commande exposée : peuple StarmapBody depuis les tables Wiki (sans réseau).
#[tauri::command]
pub async fn sync_starmap_from_wiki(app: AppHandle) -> Result<StarmapSyncResult, String> {
    sync_starmap_from_wiki_core(&app).await
}

/// Lecture de tous les corps de la carte (forme identique V1 starmap:getAll).
#[tauri::command]
pub async fn get_starmap_bodies(db_instances: tauri::State<'_, DbInstances>) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let db = instances.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let rows = sqlx::query(
        "SELECT id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, posX, posY, posZ, wikiUuid
         FROM StarmapBody
         ORDER BY systemName ASC, orbitOrder ASC, navIcon ASC, name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "recordName": r.try_get::<String, _>("recordName").unwrap_or_default(),
                "systemName": r.try_get::<String, _>("systemName").unwrap_or_default(),
                "navIcon": r.try_get::<String, _>("navIcon").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<Option<String>, _>("description").ok().flatten(),
                "size": r.try_get::<Option<f64>, _>("size").ok().flatten(),
                "parentRef": r.try_get::<Option<String>, _>("parentRef").ok().flatten(),
                "hideInStarmap": r.try_get::<i64, _>("hideInStarmap").map(|v| v != 0).unwrap_or(false),
                "showOrbitLine": r.try_get::<i64, _>("showOrbitLine").map(|v| v != 0).unwrap_or(false),
                "orbitOrder": r.try_get::<Option<i64>, _>("orbitOrder").ok().flatten(),
                "source": r.try_get::<String, _>("source").unwrap_or_default(),
                "lastSyncedAt": r.try_get::<Option<String>, _>("lastSyncedAt").ok().flatten(),
                "posX": r.try_get::<Option<f64>, _>("posX").ok().flatten(),
                "posY": r.try_get::<Option<f64>, _>("posY").ok().flatten(),
                "posZ": r.try_get::<Option<f64>, _>("posZ").ok().flatten(),
                "wikiUuid": r.try_get::<Option<String>, _>("wikiUuid").ok().flatten(),
            })
        })
        .collect())
}

/* ───────────────────── Images des corps (PNG embarqués) ───────────────────── */
// 16 PNG Stanton embarqués (include_bytes!). Pyro/Nyx/étoiles n'ont pas d'image → null.

fn body_png(stem: &str) -> Option<&'static [u8]> {
    let b: &'static [u8] = match stem {
        "stanton1" => include_bytes!("../../assets/starmap-bodies/stanton1.png"),
        "stanton1a" => include_bytes!("../../assets/starmap-bodies/stanton1a.png"),
        "stanton1b" => include_bytes!("../../assets/starmap-bodies/stanton1b.png"),
        "stanton1c" => include_bytes!("../../assets/starmap-bodies/stanton1c.png"),
        "stanton1d" => include_bytes!("../../assets/starmap-bodies/stanton1d.png"),
        "stanton2" => include_bytes!("../../assets/starmap-bodies/stanton2.png"),
        "stanton2a" => include_bytes!("../../assets/starmap-bodies/stanton2a.png"),
        "stanton2b" => include_bytes!("../../assets/starmap-bodies/stanton2b.png"),
        "stanton2c" => include_bytes!("../../assets/starmap-bodies/stanton2c.png"),
        "stanton3" => include_bytes!("../../assets/starmap-bodies/stanton3.png"),
        "stanton3a" => include_bytes!("../../assets/starmap-bodies/stanton3a.png"),
        "stanton3b" => include_bytes!("../../assets/starmap-bodies/stanton3b.png"),
        "stanton4" => include_bytes!("../../assets/starmap-bodies/stanton4.png"),
        "stanton4a" => include_bytes!("../../assets/starmap-bodies/stanton4a.png"),
        "stanton4b" => include_bytes!("../../assets/starmap-bodies/stanton4b.png"),
        "stanton4c" => include_bytes!("../../assets/starmap-bodies/stanton4c.png"),
        _ => return None,
    };
    Some(b)
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Image PNG d'un corps en data URL base64, ou null si absente. Anti-traversal sur le stem.
#[tauri::command]
pub fn get_starmap_body_image(stem: String) -> Result<Option<String>, String> {
    // Anti-path-traversal : minuscules + chiffres uniquement.
    if stem.is_empty() || !stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return Ok(None);
    }
    Ok(body_png(&stem).map(|bytes| format!("data:image/png;base64,{}", base64_encode(bytes))))
}

#[cfg(test)]
mod starmap_rsi_tests {
    use super::{map_rsi_system, write_starmap_rows, StarmapRsiRow};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;

    async fn mem_db_with_starmap() -> sqlx::SqlitePool {
        // max_connections(1) : base mémoire partagée par toutes les requêtes du test.
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE StarmapBody (id TEXT PRIMARY KEY, recordName TEXT UNIQUE, systemName TEXT,
             navIcon TEXT, name TEXT, description TEXT, size REAL, parentRef TEXT,
             hideInStarmap INTEGER DEFAULT 0, showOrbitLine INTEGER DEFAULT 0, orbitOrder INTEGER,
             source TEXT, lastSyncedAt TEXT, wikiUuid TEXT, posX REAL, posY REAL, posZ REAL,
             distance REAL, longitude REAL, latitude REAL, subtype TEXT, appearance TEXT,
             habitable INTEGER, affColor TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn writes_rows_and_preserves_hierarchy() {
        let pool = mem_db_with_starmap().await;
        let rows = map_rsi_system("STANTON", &fixture());
        let res = write_starmap_rows(&pool, &rows).await.unwrap();
        assert_eq!(res.bodies_written, 6);
        // jointure parentRef(lune) = wikiUuid(planète)
        let joined: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM StarmapBody c JOIN StarmapBody p ON c.parentRef = p.wikiUuid
             WHERE c.id = 'rsi-2737' AND p.id = 'rsi-1692'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(joined, 1);
    }

    #[tokio::test]
    async fn guard_empty_rows_keeps_table() {
        let pool = mem_db_with_starmap().await;
        sqlx::query(
            "INSERT INTO StarmapBody (id, recordName, systemName, navIcon, name, source) \
             VALUES ('x','x','stanton','Star','X','wiki')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let err = write_starmap_rows(&pool, &[]).await;
        assert!(err.is_err());
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM StarmapBody").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1, "la table ne doit pas être vidée");
    }

    fn fixture() -> serde_json::Value {
        json!({"data":{"resultset":[{"celestial_objects":[
            {"id":1691,"parent_id":null,"type":"STAR","name":null,"designation":"Stanton","distance":0,"longitude":0,"latitude":0,"size":1.2},
            {"id":1692,"parent_id":1691,"type":"PLANET","name":"microTech","designation":"Stanton IV","distance":100,"longitude":0,"latitude":0,"size":10328,"habitable":true,"appearance":"PLANET_GREEN","subtype":{"name":"Super-Earth"},"description":"desc"},
            {"id":2737,"parent_id":1692,"type":"SATELLITE","name":"Calliope","designation":"Stanton 4a","distance":10,"longitude":180,"latitude":0,"size":300},
            {"id":1689,"parent_id":null,"type":"JUMPPOINT","name":null,"designation":"Stanton - Pyro","distance":50,"longitude":90,"latitude":0},
            {"id":1698,"parent_id":1691,"type":"ASTEROID_BELT","name":"Aaron Halo","designation":null,"distance":60,"longitude":0,"latitude":0},
            {"id":9001,"parent_id":1692,"type":"MANMADE","name":"Port Tressler","designation":null,"distance":3,"longitude":45,"latitude":0}
        ]}]}})
    }
    fn find<'a>(rows: &'a [StarmapRsiRow], id: &str) -> &'a StarmapRsiRow {
        rows.iter().find(|r| r.id == id).expect("ligne absente")
    }
    fn approx(a: Option<f64>, b: f64) {
        assert!((a.unwrap() - b).abs() < 1e-6, "{:?} != {b}", a);
    }

    #[test]
    fn maps_types_to_nav_icons() {
        let rows = map_rsi_system("STANTON", &fixture());
        assert_eq!(rows.len(), 6);
        assert_eq!(find(&rows, "rsi-1691").nav_icon, "Star");
        assert_eq!(find(&rows, "rsi-1692").nav_icon, "Planet");
        assert_eq!(find(&rows, "rsi-2737").nav_icon, "Moon");
        assert_eq!(find(&rows, "rsi-1689").nav_icon, "Jumppoint");
        assert_eq!(find(&rows, "rsi-1698").nav_icon, "AsteroidBelt");
        assert_eq!(find(&rows, "rsi-9001").nav_icon, "Station");
    }
    #[test]
    fn record_name_and_system_lowercase() {
        let rows = map_rsi_system("STANTON", &fixture());
        assert_eq!(find(&rows, "rsi-1691").record_name, "stantonstar");
        assert_eq!(find(&rows, "rsi-1692").record_name, "stanton4"); // Stanton IV → 4
        assert_eq!(find(&rows, "rsi-1692").system, "stanton");
    }
    #[test]
    fn hierarchy_join_key_matches_parent_wikiuuid() {
        let rows = map_rsi_system("STANTON", &fixture());
        let moon = find(&rows, "rsi-2737");
        let planet = find(&rows, "rsi-1692");
        assert_eq!(moon.parent_ref.as_deref(), Some(planet.wiki_uuid.as_str()));
        assert_eq!(planet.wiki_uuid, "rsi-1692");
        assert_eq!(find(&rows, "rsi-1691").parent_ref, None);
    }
    #[test]
    fn derives_positions() {
        let rows = map_rsi_system("STANTON", &fixture());
        approx(find(&rows, "rsi-1691").pos_x, 0.0); // étoile au centre
        approx(find(&rows, "rsi-1692").pos_x, 100.0); // planète lon=0 → x=distance
        approx(find(&rows, "rsi-1692").pos_y, 0.0);
        approx(find(&rows, "rsi-2737").pos_x, 90.0); // planète(100) + lune local(lon180 → -10)
    }
    #[test]
    fn rich_fields_and_guard() {
        let rows = map_rsi_system("STANTON", &fixture());
        let p = find(&rows, "rsi-1692");
        assert_eq!(p.habitable, Some(1));
        assert_eq!(p.appearance.as_deref(), Some("PLANET_GREEN"));
        assert_eq!(p.subtype.as_deref(), Some("Super-Earth"));
        assert_eq!(p.orbit_order, Some(4));
        assert!(map_rsi_system("STANTON", &json!({})).is_empty()); // garde-fou
    }

    #[tokio::test]
    async fn migration_0031_adds_columns() {
        // max_connections(1) : sinon chaque connexion du pool ouvre une base mémoire DISTINCTE.
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE StarmapBody (id TEXT PRIMARY KEY)").execute(&pool).await.unwrap();
        let sql = include_str!("../../migrations/0031_starmap_rsi.sql");
        for stmt in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            sqlx::query(stmt).execute(&pool).await.unwrap();
        }
        let cols: Vec<String> = sqlx::query("PRAGMA table_info(StarmapBody)")
            .fetch_all(&pool).await.unwrap()
            .iter().map(|r| r.get::<String, _>("name")).collect();
        for c in ["distance", "longitude", "latitude", "subtype", "appearance", "habitable", "affColor"] {
            assert!(cols.contains(&c.to_string()), "colonne manquante : {c}");
        }
    }
}
