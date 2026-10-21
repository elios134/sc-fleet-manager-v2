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
    crate::commands::app_meta::get(pool, key).await.filter(|s| !s.trim().is_empty())
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

/// Commande exposée : enrichit depuis la copie stable des dumps.
#[tauri::command]
pub async fn enrich_blueprint_stats(app: AppHandle) -> Result<StatsEnrichResult, String> {
    let dir = resolve_dump_dir(&app).await;
    enrich_blueprint_stats_core(&app, &dir).await
}

/// Commande exposée : peuple producedItemNameFr depuis la copie stable des dumps.
#[tauri::command]
pub async fn backfill_blueprint_names_fr(app: AppHandle) -> Result<FrNamesBackfillResult, String> {
    let dir = resolve_dump_dir(&app).await;
    backfill_blueprint_names_fr_core(&app, &dir).await
}

/// Commande exposée : peuple ResourceMiningLocation depuis la copie stable.
#[tauri::command]
pub async fn sync_mining_locations(app: AppHandle) -> Result<MiningSyncResult, String> {
    let dir = resolve_dump_dir(&app).await;
    sync_mining_locations_core(&app, &dir).await
}

/* ═══════════════════ Starmap (StarmapBody) — résultat partagé ═══════════════════ */
// Type de résultat commun aux syncs de la carte (Wiki en base + RSI ci-dessous).
// L'ancien parser datamining (dumps → StarmapBody, sans coordonnées) a été retiré :
// la carte est désormais alimentée par le Wiki (coords réelles) et l'API RSI.

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

/* ───────────────────── STARMAP via API RSI (sous-projet A) ───────────────────── */

pub(crate) mod starmap_rsi;
pub(crate) mod starmap_wiki_stations;
pub use starmap_rsi::spawn_starmap_sync;

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
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, posX, posY, posZ, wikiUuid,
                appearance, habitable, distance, longitude, latitude, subtype, affColor, realX, realY, realZ
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
                "appearance": r.try_get::<Option<String>, _>("appearance").ok().flatten(),
                "habitable": r.try_get::<Option<i64>, _>("habitable").ok().flatten(),
                "distance": r.try_get::<Option<f64>, _>("distance").ok().flatten(),
                "longitude": r.try_get::<Option<f64>, _>("longitude").ok().flatten(),
                "latitude": r.try_get::<Option<f64>, _>("latitude").ok().flatten(),
                "subtype": r.try_get::<Option<String>, _>("subtype").ok().flatten(),
                "affColor": r.try_get::<Option<String>, _>("affColor").ok().flatten(),
                "realX": r.try_get::<Option<f64>, _>("realX").ok().flatten(),
                "realY": r.try_get::<Option<f64>, _>("realY").ok().flatten(),
                "realZ": r.try_get::<Option<f64>, _>("realZ").ok().flatten(),
            })
        })
        .collect())
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
mod blueprint_stats;
pub(crate) use blueprint_stats::*;
mod blueprint_names;
pub(crate) use blueprint_names::*;
mod mining;
pub(crate) use mining::*;
mod starmap_wiki;
pub(crate) use starmap_wiki::*;