// Détection de la version installée de Star Citizen (Lot A — brique de lecture pure).
// Port Rust de la chaîne V1 : detector.ts (detectScInstall), scInstallResolver.ts,
// starbreakerRunner.ts:78 (readBuildVersion), handlers/datamining.ts (getPatchStatusPayload).
//
// Lecture seule : std::fs + `reg query` en sous-process. AUCUN réseau, AUCUNE écriture.
// La comparaison « nouveau patch » se fait par CHANGENUM P4 (entier) : la version installée
// (build_manifest.id → Data.Version « 1.0.182.… ») et la version des données de l'app
// (AppMeta *.lastSyncedGameVersion « 4.8.1-LIVE.11952564 ») ont des formats marketing
// différents — seul RequestedP4ChangeNum (== suffixe après le dernier point) est commun.
//
// Lot A = brique testable via la commande get_patch_status. PAS de notif (Lot B).

use serde_json::{json, Value};
use sqlx::Row;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

// Canaux, par priorité décroissante (LIVE gagne).
const CHANNELS: [&str; 4] = ["LIVE", "PTU", "EPTU", "TECH-PREVIEW"];

fn channel_priority(channel: &str) -> usize {
    CHANNELS.iter().position(|c| *c == channel).unwrap_or(99)
}

/* ───────────────────────────── Validation disque ───────────────────────────── */

/// Un install valide possède Data.p4k à sa racine (même critère que V1).
fn is_valid_install(install_path: &str) -> bool {
    Path::new(install_path).join("Data.p4k").is_file()
}

/// Pour le log launcher, V1 exige aussi Bin64\StarCitizen.exe (écarte les entrées obsolètes).
fn has_game_binary(install_path: &str) -> bool {
    Path::new(install_path)
        .join("Bin64")
        .join("StarCitizen.exe")
        .is_file()
}

/// Déduit le canal depuis le suffixe du dossier (…\LIVE, …\PTU, …\EPTU, …TECH-PREVIEW).
fn detect_channel_from_path(p: &str) -> Option<&'static str> {
    let up = p.to_uppercase();
    if up.ends_with("\\LIVE") || up.ends_with("/LIVE") {
        Some("LIVE")
    } else if up.ends_with("\\PTU") || up.ends_with("/PTU") {
        Some("PTU")
    } else if up.ends_with("\\EPTU") || up.ends_with("/EPTU") {
        Some("EPTU")
    } else if up.contains("TECH-PREVIEW") {
        Some("TECH-PREVIEW")
    } else {
        None
    }
}

/* ─────────────────────────── Sources de candidats ─────────────────────────── */

/// (b) Log launcher RSI %APPDATA%\rsilauncher\logs\log.log : extrait les chemins
/// …\StarCitizen\<CANAL>, du plus récent au plus ancien, validés sur disque.
fn candidates_from_launcher_log() -> Vec<(String, String)> {
    let Ok(appdata) = std::env::var("APPDATA") else {
        return vec![];
    };
    let log_path = Path::new(&appdata)
        .join("rsilauncher")
        .join("logs")
        .join("log.log");
    let Ok(text) = std::fs::read_to_string(&log_path) else {
        return vec![];
    };

    // Le launcher écrit du JSON : les backslashes apparaissent doublés (\\). On capture
    // un chemin drive-rooté finissant par …\StarCitizen\<segment>, puis on réduit les
    // suites de backslashes à un seul.
    let re = regex::Regex::new(r#"[A-Za-z]:(?:\\+[^\\",()\r\n]+)*\\+StarCitizen\\+[A-Za-z0-9_.@-]+"#)
        .expect("regex chemin launcher valide");
    let collapse = regex::Regex::new(r"\\+").expect("regex collapse valide");

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<(String, String)> = Vec::new();
    // Plus récent d'abord : la dernière occurrence d'un chemin gagne au dédoublonnage.
    for line in text.lines().rev() {
        for m in re.find_iter(line) {
            let real = collapse.replace_all(m.as_str(), "\\").to_string();
            if !seen.insert(real.clone()) {
                continue;
            }
            let Some(channel) = detect_channel_from_path(&real) else {
                continue; // …\StarCitizen nu ou canal inconnu (ex. HOTFIX)
            };
            if is_valid_install(&real) && has_game_binary(&real) {
                out.push((real, channel.to_string()));
            }
        }
    }
    out
}

/// (c) Chemins connus en dur × canaux (filet de secours).
fn hardcoded_candidates() -> Vec<(String, String)> {
    let roots = [
        r"C:\Program Files\Roberts Space Industries\StarCitizen",
        r"D:\Program Files\Roberts Space Industries\StarCitizen",
        r"E:\Program Files\Roberts Space Industries\StarCitizen",
        r"C:\Program Files\RSI Launcher\StarCitizen",
        r"D:\Program Files\RSI Launcher\StarCitizen",
        r"E:\Program Files\RSI Launcher\StarCitizen",
        r"C:\Games\Roberts Space Industries\StarCitizen",
        r"D:\Games\Roberts Space Industries\StarCitizen",
        r"E:\Games\Roberts Space Industries\StarCitizen",
    ];
    let mut out = Vec::new();
    for root in roots {
        for channel in CHANNELS {
            let p = format!("{root}\\{channel}");
            out.push((p, channel.to_string()));
        }
    }
    out
}

/// (d) Registre Windows via `reg query` (pas de nouvelle dépendance). Absente sur certaines
/// machines : on retombe silencieusement sur les autres sources.
fn candidates_from_registry() -> Vec<(String, String)> {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\WOW6432Node\Cloud Imperium Games\StarCitizen",
            "/v",
            "installpath",
        ])
        .output();
    let Ok(out) = output else {
        return vec![];
    };
    if !out.status.success() {
        return vec![];
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // Ligne attendue : "    installpath    REG_SZ    <chemin>"
    let mut reg_path: Option<String> = None;
    for line in text.lines() {
        if let Some(idx) = line.to_uppercase().find("REG_SZ") {
            let val = line[idx + "REG_SZ".len()..].trim();
            if !val.is_empty() {
                reg_path = Some(val.to_string());
                break;
            }
        }
    }
    let Some(reg_path) = reg_path else {
        return vec![];
    };

    // Si installpath pointe déjà sur un dossier de canal → tel quel, sinon on suffixe.
    if let Some(channel) = detect_channel_from_path(&reg_path) {
        vec![(reg_path, channel.to_string())]
    } else {
        CHANNELS
            .iter()
            .map(|c| (format!("{reg_path}\\{c}"), c.to_string()))
            .collect()
    }
}

/* ─────────────────────────── Résolution de l'install ───────────────────────── */

/// Cascade : (a) chemin configuré (AppMeta) prioritaire s'il est valide, puis (b) log
/// launcher, (c) chemins connus, (d) registre. Le tout trié par priorité de canal
/// (LIVE > PTU > EPTU > TECH-PREVIEW). Retourne le 1er install dont Data.p4k existe.
fn resolve_sc_install(configured: Option<String>) -> Option<(String, String)> {
    // Candidat configuré épinglé en tête (canal déduit, défaut LIVE).
    let mut pinned: Option<(String, String)> = None;
    if let Some(cfg) = configured {
        if !cfg.trim().is_empty() {
            let channel = detect_channel_from_path(&cfg).unwrap_or("LIVE").to_string();
            pinned = Some((cfg, channel));
        }
    }

    let mut rest: Vec<(String, String)> = Vec::new();
    rest.extend(candidates_from_launcher_log());
    rest.extend(hardcoded_candidates());
    rest.extend(candidates_from_registry());
    // Tri stable par priorité de canal (conserve l'ordre des sources à canal égal).
    rest.sort_by_key(|(_, ch)| channel_priority(ch));

    // Le configuré passe devant s'il est valide.
    if let Some((p, ch)) = pinned {
        if is_valid_install(&p) {
            return Some((p, ch));
        }
    }
    rest.into_iter().find(|(p, _)| is_valid_install(p))
}

/* ─────────────────────────── Lecture du manifeste ─────────────────────────── */

struct BuildManifest {
    version: Option<String>,
    branch: Option<String>,
    changenum: Option<String>,
}

/// Lit <installPath>\build_manifest.id (JSON) → Data.{Version,Branch,RequestedP4ChangeNum}.
/// None si fichier absent / illisible / JSON invalide (jamais de panique).
fn read_build_manifest(install_path: &str) -> Option<BuildManifest> {
    let manifest_path: PathBuf = Path::new(install_path).join("build_manifest.id");
    let raw = std::fs::read_to_string(&manifest_path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    let data = parsed.get("Data")?;
    let s = |k: &str| data.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Some(BuildManifest {
        version: s("Version"),
        branch: s("Branch"),
        changenum: s("RequestedP4ChangeNum"),
    })
}

/* ─────────────────────────── Référence datamining ─────────────────────────── */

async fn app_meta_get(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
}

/// Extrait le changenum = suffixe entier après le dernier point (« 4.8.1-LIVE.11952564 » →
/// 11952564). Sert aussi pour RequestedP4ChangeNum (« 11952564 » → 11952564, pas de point).
fn extract_changenum(s: &str) -> Option<i64> {
    let tail = s.rsplit('.').next().unwrap_or(s);
    tail.trim().parse::<i64>().ok()
}

/// Changenum de référence = données synchronisées les plus fraîches de l'app. On lit les
/// deux clés AppMeta (missions/blueprints) et on garde le changenum le PLUS GRAND (le plus
/// récent). None si aucune référence exploitable.
async fn reference_changenum(pool: &sqlx::SqlitePool) -> Option<i64> {
    let keys = [
        "missions.lastSyncedGameVersion",
        "blueprints.lastSyncedGameVersion",
    ];
    let mut best: Option<i64> = None;
    for k in keys {
        if let Some(v) = app_meta_get(pool, k).await {
            if let Some(c) = extract_changenum(&v) {
                best = Some(best.map_or(c, |b| b.max(c)));
            }
        }
    }
    best
}

/* ──────────────────────────────── Commande ───────────────────────────────── */

/// Calcule le statut patch (lecture pure) à partir d'un pool. Réutilisé par la commande
/// exposée ET par le déclencheur de notification (Lot B). status :
///  - "up_to_date"     : changenum installé == référence
///  - "patch_detected" : changenum installé != référence (jeu patché vs données de l'app)
///  - "unknown"        : pas d'install / manifeste illisible / pas de référence (jamais de
///                       faux positif)
pub async fn compute_patch_status(pool: &sqlx::SqlitePool) -> Value {
    // Chemin d'install configuré (optionnel) — AppMeta, prioritaire s'il est valide.
    let configured = app_meta_get(pool, "datamining.scInstallPath").await;

    let install = resolve_sc_install(configured);
    let reference = reference_changenum(pool).await;

    let (installed_version, installed_branch, installed_changenum, installed_channel) =
        match &install {
            Some((path, channel)) => match read_build_manifest(path) {
                Some(m) => (
                    m.version,
                    m.branch,
                    m.changenum.as_deref().and_then(extract_changenum),
                    Some(channel.clone()),
                ),
                None => (None, None, None, Some(channel.clone())),
            },
            None => (None, None, None, None),
        };

    let status = match (installed_changenum, reference) {
        (Some(inst), Some(refc)) => {
            if inst == refc {
                "up_to_date"
            } else {
                "patch_detected"
            }
        }
        _ => "unknown",
    };

    json!({
        "status": status,
        "installedVersion": installed_version,
        "installedBranch": installed_branch,
        "installedChangenum": installed_changenum,
        "installedChannel": installed_channel,
        "referenceChangenum": reference,
    })
}

/// Commande exposée : statut patch (lecture pure).
#[tauri::command]
pub async fn get_patch_status(db_instances: State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    Ok(compute_patch_status(pool).await)
}
