// Bloc 4 — Grille de soute (écran 2). Compositions de conteneurs par vaisseau,
// EN DUR depuis le Cargo Grid Reference Guide (PDF). INDÉPENDANT de l'API prix.
// La COMPOSITION (taille × nombre) est fidèle au guide (sommes validées) ; le
// PLACEMENT spatial exact n'est pas reproduit (la vue iso est une approximation).
//
// Clé = nom de vaisseau (normalisé) ; alignée sur ShipData / la flotte.

use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

/// Une entrée du guide : variantes de nom + conteneurs (taille SCU, nombre).
struct GridEntry {
    names: &'static [&'static str],
    containers: &'static [(u32, u32)], // (sizeScu, count)
    tentative: bool,                   // légende ambiguë → "à confirmer"
}

// Source : Cargo Grid Reference Guide — Ratjack (As of Patch 4.8), légendes ÉCRITES.
// 77 vaisseaux ; chaque composition somme au total imprimé (sauf A2 Hercules : la
// légende du PDF écrit 6×32+1×4=196 mais le total officiel est 216 → corrigé en
// 6×32+1×24=216). Notes du PDF (placement, non bloquantes pour la COMPOSITION) :
//   • Buffers : certains vaisseaux ont des "X SCU Buffer" (espace perdu) au-dessus.
//   • Caterpillar : "les boîtes 2 SCU de la section arrière flottent / sortent du toit"
//     (bug d'arrimage) — n'affecte pas le nombre de conteneurs.
const GRID: &[GridEntry] = &[
    // ── Flotte d'André ──
    GridEntry { names: &["Asgard"], containers: &[(32, 4), (2, 24), (1, 4)], tentative: false }, // 180
    GridEntry { names: &["Perseus"], containers: &[(32, 3)], tentative: false },                  // 96
    GridEntry { names: &["Clipper", "Caterpillar Clipper"], containers: &[(2, 6)], tentative: false }, // 12
    GridEntry { names: &["Aurora Mk II", "Aurora MR Mk II"], containers: &[(1, 2)], tentative: false }, // 2 (2× 1 SCU)
    GridEntry { names: &["Aurora Mk II w/ Cargo Module", "Aurora MR Cargo"], containers: &[(4, 1), (2, 2)], tentative: false }, // 8
    // ── Hercules ──
    GridEntry { names: &["C2 Hercules", "Hercules Starlifter C2"], containers: &[(32, 20), (2, 28)], tentative: false }, // 696
    GridEntry { names: &["M2 Hercules", "Hercules Starlifter M2"], containers: &[(32, 10), (4, 40), (2, 21)], tentative: false }, // 522
    GridEntry { names: &["A2 Hercules", "Hercules Starlifter A2"], containers: &[(32, 6), (24, 1)], tentative: false }, // 216 (total officiel prime)
    GridEntry { names: &["C1 Spirit", "Spirit C1"], containers: &[(32, 2)], tentative: false }, // 64
    // ── Gros cargos ──
    GridEntry { names: &["Caterpillar"], containers: &[(24, 18), (4, 4), (2, 56), (1, 16)], tentative: false }, // 576
    GridEntry { names: &["Mercury Star Runner", "Mercury"], containers: &[(24, 3), (4, 9), (2, 2), (1, 2)], tentative: false }, // 114
    GridEntry { names: &["Corsair"], containers: &[(32, 2), (2, 4)], tentative: false }, // 72
    GridEntry { names: &["RAFT", "Argo RAFT"], containers: &[(32, 6)], tentative: false }, // 192
    GridEntry { names: &["Moth"], containers: &[(24, 8), (16, 2)], tentative: false }, // 224
    GridEntry { names: &["Mole", "Argo Mole", "MOLE"], containers: &[(16, 2)], tentative: false }, // 32
    GridEntry { names: &["Nomad"], containers: &[(16, 1), (2, 4)], tentative: false }, // 24
    GridEntry { names: &["Vulture"], containers: &[(8, 1), (2, 2)], tentative: false }, // 12
    GridEntry { names: &["Reclaimer"], containers: &[(16, 10), (8, 8), (4, 8), (2, 72), (1, 20)], tentative: false }, // 420
    GridEntry { names: &["Carrack"], containers: &[(16, 24), (8, 6), (2, 12)], tentative: false }, // 456
    GridEntry { names: &["Valkyrie"], containers: &[(24, 2), (4, 6), (2, 9)], tentative: false }, // 90
    GridEntry { names: &["Starfarer", "Starfarer Gemini"], containers: &[(24, 6), (16, 2), (4, 10), (2, 35), (1, 5)], tentative: false }, // 291
    // ── Constellation ──
    GridEntry { names: &["Constellation Taurus"], containers: &[(32, 2), (24, 2), (4, 14), (1, 6)], tentative: false }, // 174
    GridEntry { names: &["Constellation Andromeda", "Constellation Aquila"], containers: &[(32, 2), (4, 8)], tentative: false }, // 96
    GridEntry { names: &["Constellation Phoenix"], containers: &[(32, 2), (2, 8)], tentative: false }, // 80
    // ── Hull / Ironclad / Idris (gros) ──
    GridEntry { names: &["Hull A", "MISC Hull A"], containers: &[(16, 4)], tentative: false }, // 64
    GridEntry { names: &["Hull B", "MISC Hull B"], containers: &[(32, 16)], tentative: false }, // 512
    GridEntry { names: &["Hull C", "MISC Hull C"], containers: &[(32, 144)], tentative: false }, // 4608
    GridEntry { names: &["Ironclad"], containers: &[(32, 54), (24, 18), (8, 2), (1, 40)], tentative: false }, // 2216
    GridEntry { names: &["Ironclad Assault"], containers: &[(32, 36), (24, 12), (8, 2)], tentative: false }, // 1456
    GridEntry { names: &["Idris-P", "Idris-P Frigate"], containers: &[(16, 80), (2, 46), (1, 2)], tentative: false }, // 1374
    GridEntry { names: &["Idris-M", "Idris-M Frigate"], containers: &[(16, 80), (2, 22), (1, 2)], tentative: false }, // 1326
    // ── Starlancer / Freelancer ──
    GridEntry { names: &["Starlancer MAX"], containers: &[(32, 6), (4, 8)], tentative: false }, // 224
    GridEntry { names: &["Starlancer TAC"], containers: &[(32, 2), (4, 8)], tentative: false }, // 96
    GridEntry { names: &["Freelancer"], containers: &[(32, 1), (4, 4), (2, 9)], tentative: false }, // 66
    GridEntry { names: &["Freelancer MAX"], containers: &[(32, 2), (4, 8), (2, 12)], tentative: false }, // 120
    GridEntry { names: &["Freelancer MIS", "Freelancer DUR"], containers: &[(16, 1), (4, 2), (2, 6)], tentative: false }, // 36
    // ── Capital / autres ──
    GridEntry { names: &["Polaris"], containers: &[(32, 12), (24, 8)], tentative: false }, // 576
    GridEntry { names: &["Hermes", "Genesis Starliner"], containers: &[(32, 8), (16, 2)], tentative: false }, // 288
    GridEntry { names: &["890 Jump"], containers: &[(32, 6), (24, 4), (16, 2), (2, 28), (1, 12)], tentative: false }, // 388
    GridEntry { names: &["Hammerhead", "Tiburon"], containers: &[(32, 2)], tentative: false }, // 64
    GridEntry { names: &["Apollo", "Apollo Triage", "Apollo Medivac"], containers: &[(2, 16)], tentative: false }, // 32
    GridEntry { names: &["Salvation", "Polaris Salvation"], containers: &[(1, 6)], tentative: false }, // 6
    GridEntry { names: &["Redeemer"], containers: &[(1, 2)], tentative: false }, // 2
    GridEntry { names: &["Zeus Mk II CL", "Zeus CL"], containers: &[(32, 2), (4, 8), (2, 16)], tentative: false }, // 128
    GridEntry { names: &["Zeus Mk II ES", "Zeus ES"], containers: &[(16, 2)], tentative: false }, // 32
    // ── Cutlass / petits-moyens ──
    GridEntry { names: &["Cutlass Black"], containers: &[(16, 2), (2, 6), (1, 2)], tentative: false }, // 46
    GridEntry { names: &["Cutlass Red", "Cutlass Blue"], containers: &[(2, 4), (1, 4)], tentative: false }, // 12
    GridEntry { names: &["Golem", "Golem OX"], containers: &[(32, 2)], tentative: false }, // 64
    GridEntry { names: &["Prowler", "Prowler Utility"], containers: &[(16, 2)], tentative: false }, // 32
    GridEntry { names: &["SRV"], containers: &[(4, 2), (2, 2)], tentative: false }, // 12
    GridEntry { names: &["Intrepid"], containers: &[(2, 4)], tentative: false }, // 8
    GridEntry { names: &["Cutter"], containers: &[(1, 4)], tentative: false }, // 4
    GridEntry { names: &["Cutter Scout", "Cutter Rambler"], containers: &[(1, 2)], tentative: false }, // 2
    GridEntry { names: &["Avenger Titan"], containers: &[(4, 2)], tentative: false }, // 8
    GridEntry { names: &["Aurora ES", "Aurora LN", "Aurora LX", "Aurora MR"], containers: &[(2, 1), (1, 1)], tentative: false }, // 3
    GridEntry { names: &["Aurora CL", "Aurora SE"], containers: &[(2, 3)], tentative: false }, // 6
    GridEntry { names: &["Mule", "Greycat Mule"], containers: &[(1, 1)], tentative: false }, // 1
    GridEntry { names: &["Reliant Tana", "Reliant Sen", "Reliant Mako"], containers: &[(1, 1)], tentative: false }, // 1
    GridEntry { names: &["Reliant Kore"], containers: &[(2, 2), (1, 2)], tentative: false }, // 6
    GridEntry { names: &["Fortune", "Vulture Fortune"], containers: &[(4, 1), (1, 12)], tentative: false }, // 16
    GridEntry { names: &["Hornet F7C Mk II", "F7C Hornet Mk II"], containers: &[(1, 2)], tentative: false }, // 2
    GridEntry { names: &["Paladin"], containers: &[(2, 2)], tentative: false }, // 4
    GridEntry { names: &["Pisces C8", "Pisces C8X", "C8 Pisces"], containers: &[(2, 2)], tentative: false }, // 4
    GridEntry { names: &["325a", "350r"], containers: &[(4, 1)], tentative: false }, // 4
    GridEntry { names: &["300i"], containers: &[(4, 2)], tentative: false }, // 8
    GridEntry { names: &["315p"], containers: &[(4, 3)], tentative: false }, // 12
    GridEntry { names: &["400i"], containers: &[(24, 1), (2, 8), (1, 2)], tentative: false }, // 42
    GridEntry { names: &["100i", "125a", "M80", "M80 Buggy"], containers: &[(2, 1)], tentative: false }, // 2 (M80 = 1× 2 SCU)
    GridEntry { names: &["600i Touring"], containers: &[(2, 8), (1, 4)], tentative: false }, // 20
    GridEntry { names: &["600i Explorer"], containers: &[(24, 1), (2, 8), (1, 4)], tentative: true }, // 44 (étendu pour atteindre le total officiel — à confirmer)
    GridEntry { names: &["135c"], containers: &[(2, 3)], tentative: true }, // 6 (légende non lue — à confirmer)
    GridEntry { names: &["MPUV-C", "MPUV Cargo"], containers: &[(2, 1)], tentative: false }, // 2
    GridEntry { names: &["MPUV-T", "MPUV Tractor"], containers: &[(16, 1)], tentative: false }, // 16
    GridEntry { names: &["CSV-SM"], containers: &[(4, 1)], tentative: false }, // 4
    GridEntry { names: &["Mustang Alpha"], containers: &[(2, 2)], tentative: false }, // 4
    GridEntry { names: &["Shiv"], containers: &[(32, 1)], tentative: false }, // 32
    GridEntry { names: &["Syulen"], containers: &[(1, 6)], tentative: false }, // 6
    GridEntry { names: &["Cyclone"], containers: &[(1, 1)], tentative: false }, // 1
    GridEntry { names: &["UTV"], containers: &[(1, 1)], tentative: false }, // 1
];

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub size_scu: u32,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoGridResult {
    pub ship_name: String,
    pub found: bool,
    pub tentative: bool,
    pub total_scu: u32,
    pub container_count: u32,
    pub containers: Vec<Container>,
}

/// Composition de la soute d'un vaisseau (en dur, depuis le guide). found=false si inconnu.
#[tauri::command]
pub fn get_cargo_grid(ship_name: String) -> Result<CargoGridResult, String> {
    let key = norm(&ship_name);
    let entry = GRID.iter().find(|e| e.names.iter().any(|n| norm(n) == key));
    match entry {
        Some(e) => {
            let containers: Vec<Container> =
                e.containers.iter().map(|&(s, c)| Container { size_scu: s, count: c }).collect();
            let total: u32 = e.containers.iter().map(|&(s, c)| s * c).sum();
            let cnt: u32 = e.containers.iter().map(|&(_, c)| c).sum();
            Ok(CargoGridResult {
                ship_name,
                found: true,
                tentative: e.tentative,
                total_scu: total,
                container_count: cnt,
                containers,
            })
        }
        None => Ok(CargoGridResult {
            ship_name,
            found: false,
            tentative: false,
            total_scu: 0,
            container_count: 0,
            containers: Vec::new(),
        }),
    }
}

/* ───────────────────────  Baies réelles (SC Wiki API v3)  ──────────────────────
   Géométrie réelle des grilles de soute. Chaque grille (`cargo_grids`) est une
   boîte parfaite de cellules 1,25 m (scu = nb de cellules). On expose les baies en
   CELLULES (cols×rows×layers) + la taille max de conteneur, pour un packing 3D fidèle
   côté front. 100 % donnée publique Wiki ; cache 24 h ; fallback gracieux (found=false)
   → le front retombe alors sur la composition Ratjack + vue approximative.
   NB : le placement EXACT des conteneurs in-game n'est fourni par aucune source. */

const WIKI_V3_BASE: &str = "https://api.star-citizen.wiki/api/v3/vehicles";
const CELL_M: f64 = 1.25; // 1 cellule = 1,25 m = 1 SCU
const BAYS_CACHE_TTL_SECS: u64 = 24 * 60 * 60;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bay {
    pub cols: u32,   // largeur (X)
    pub rows: u32,   // profondeur (Z)
    pub layers: u32, // hauteur (Y)
    pub scu: u32,
    pub max_scu_box: u32,
    pub open: bool,
    pub external: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CargoBaysResult {
    pub ship_name: String,
    pub found: bool,
    pub total_scu: u32,
    pub bays: Vec<Bay>,
}

/// Percent-encode minimal pour insérer un nom de vaisseau dans un segment d'URL.
fn slug_encode(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            other => other
                .to_string()
                .bytes()
                .map(|b| format!("%{b:02X}"))
                .collect(),
        })
        .collect()
}

fn round_cells(meters: f64) -> u32 {
    (meters / CELL_M).round().max(0.0) as u32
}

/// Parse `data.cargo_grids` (objet vaisseau v3) → baies en cellules. Ignore les
/// grilles dégénérées (dimension ou scu nul).
fn parse_bays(data: &serde_json::Value) -> Vec<Bay> {
    let Some(grids) = data.get("cargo_grids").and_then(|g| g.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for g in grids {
        let f = |k: &str| g.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let cols = round_cells(f("width"));
        let rows = round_cells(f("length"));
        let layers = round_cells(f("height"));
        let scu = f("scu").round().max(0.0) as u32;
        if cols == 0 || rows == 0 || layers == 0 || scu == 0 {
            continue;
        }
        let max_scu_box = g.get("max_scu_box").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
        out.push(Bay {
            cols,
            rows,
            layers,
            scu,
            max_scu_box: max_scu_box.max(1),
            open: g.get("open").and_then(|v| v.as_bool()).unwrap_or(false),
            external: g.get("external").and_then(|v| v.as_bool()).unwrap_or(false),
        });
    }
    out
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

async fn fetch_bays(ship_name: &str) -> Result<Vec<Bay>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("SCFleetManager/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{WIKI_V3_BASE}/{}", slug_encode(ship_name));
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("SC Wiki {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let data = json.get("data").unwrap_or(&json);
    Ok(parse_bays(data))
}

/// Baies réelles d'un vaisseau (SC Wiki v3), en cellules 1,25 m. found=false si le
/// vaisseau est introuvable, sans grilles, ou en cas d'échec réseau sans cache.
#[tauri::command]
pub async fn get_cargo_bays(
    ship_name: String,
    db_instances: State<'_, DbInstances>,
) -> Result<CargoBaysResult, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let key = format!("cargo.bays.{}", norm(&ship_name));

    // Cache frais (positif OU négatif) → pas de réseau.
    if let Some(raw) = crate::commands::app_meta::get(pool, &key).await {
        if let Ok(cached) = serde_json::from_str::<(u64, Vec<Bay>)>(&raw) {
            if now_secs().saturating_sub(cached.0) < BAYS_CACHE_TTL_SECS {
                return Ok(build_bays_result(ship_name, cached.1));
            }
        }
    }

    match fetch_bays(&ship_name).await {
        Ok(bays) => {
            // Cache (y compris résultat vide = négatif, pour ne pas marteler l'API).
            if let Ok(blob) = serde_json::to_string(&(now_secs(), &bays)) {
                let _ = crate::commands::app_meta::set(pool, &key, &blob).await;
            }
            Ok(build_bays_result(ship_name, bays))
        }
        // Réseau KO sans cache exploitable → found=false (fallback front).
        Err(_) => Ok(build_bays_result(ship_name, Vec::new())),
    }
}

fn build_bays_result(ship_name: String, bays: Vec<Bay>) -> CargoBaysResult {
    let total: u32 = bays.iter().map(|b| b.scu).sum();
    CargoBaysResult { ship_name, found: !bays.is_empty(), total_scu: total, bays }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_cells_maps_meters_to_125_units() {
        assert_eq!(round_cells(6.25), 5); // largeur Caterpillar baie 1
        assert_eq!(round_cells(3.75), 3); // hauteur
        assert_eq!(round_cells(5.0), 4); // profondeur
        assert_eq!(round_cells(1.25), 1);
        assert_eq!(round_cells(0.0), 0);
    }

    #[test]
    fn slug_encode_handles_spaces() {
        assert_eq!(slug_encode("Caterpillar"), "Caterpillar");
        assert_eq!(slug_encode("C2 Hercules"), "C2%20Hercules");
        assert_eq!(slug_encode("Constellation Andromeda"), "Constellation%20Andromeda");
    }

    #[test]
    fn parse_bays_reads_grids_and_skips_degenerate() {
        let data = json!({
            "cargo_grids": [
                { "width": 6.25, "height": 3.75, "length": 5.0, "scu": 60, "max_scu_box": 32, "open": true, "external": true },
                { "width": 0.0, "height": 3.75, "length": 5.0, "scu": 60, "max_scu_box": 32 }, // dégénérée → ignorée
                { "width": 5.0, "height": 2.5, "length": 1.25, "scu": 8, "max_scu_box": 2, "open": false, "external": false }
            ]
        });
        let bays = parse_bays(&data);
        assert_eq!(bays.len(), 2);
        let b0 = &bays[0];
        assert_eq!((b0.cols, b0.layers, b0.rows), (5, 3, 4));
        assert_eq!(b0.scu, 60);
        assert_eq!(b0.max_scu_box, 32);
        assert!(b0.open && b0.external);
        // cellules cohérentes avec le scu (boîte parfaite 1,25 m)
        assert_eq!(b0.cols * b0.rows * b0.layers, b0.scu);
        assert_eq!(bays[1].max_scu_box, 2);
    }

    #[test]
    fn parse_bays_empty_when_absent() {
        assert!(parse_bays(&json!({ "name": "Nope" })).is_empty());
    }
}
