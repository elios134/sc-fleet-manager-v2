// Bloc 4 — Grille de soute (écran 2). Compositions de conteneurs par vaisseau,
// EN DUR depuis le Cargo Grid Reference Guide (PDF). INDÉPENDANT de l'API prix.
// La COMPOSITION (taille × nombre) est fidèle au guide (sommes validées) ; le
// PLACEMENT spatial exact n'est pas reproduit (la vue iso est une approximation).
//
// Clé = nom de vaisseau (normalisé) ; alignée sur ShipData / la flotte.

use serde::Serialize;

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
