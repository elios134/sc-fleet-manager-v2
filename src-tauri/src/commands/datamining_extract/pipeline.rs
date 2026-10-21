// Séquence d'extraction (phases V1), apply enchaîné, AppMeta et validation du chemin d'install.
use super::*;

/* ─────────────────────── Phase 1 — noms de classes (SC Wiki) ───────────────── */

pub(crate) fn fetch_class_names() -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut names = Vec::new();
    let mut page = 1u32;
    loop {
        check_cancel()?;
        let url = format!("{SC_WIKI_VEHICLES}?limit=100&page={page}");

        // Jusqu'à 3 tentatives (backoff simple) — réplique de l'esprit de wikiGet V1.
        let mut body: Option<Value> = None;
        let mut last_err = String::new();
        for attempt in 0..3 {
            check_cancel()?;
            match client.get(&url).send() {
                Ok(resp) if resp.status().is_success() => match resp.json::<Value>() {
                    Ok(v) => {
                        body = Some(v);
                        break;
                    }
                    Err(e) => last_err = e.to_string(),
                },
                Ok(resp) => last_err = format!("SC Wiki {}", resp.status()),
                Err(e) => last_err = e.to_string(),
            }
            std::thread::sleep(Duration::from_millis(500 * (1 << attempt)));
        }
        let body = body.ok_or_else(|| format!("SC Wiki injoignable : {last_err}"))?;

        if let Some(arr) = body.get("data").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(cn) = v.get("class_name").and_then(|c| c.as_str()) {
                    if !cn.is_empty() {
                        names.push(cn.to_string());
                    }
                }
            }
        }
        let last_page = body
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;
        if page >= last_page {
            break;
        }
        page += 1;
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(names)
}

/* ──────────────────────── Phase d'extraction non-fatale ────────────────────── */

/// dcb extract d'un sous-arbre vers `out`. Échec d'extract = non-fatal (warn + skip) ;
/// SAUF si l'échec vient d'une annulation → on propage.
pub(crate) fn extract_subtree(
    app: &AppHandle,
    bin: &Path,
    p4k: &str,
    out: &Path,
    filter: &str,
    phase: &str,
    message: &str,
) -> Result<(), String> {
    check_cancel()?;
    update_status(|s| {
        s.phase = Some(phase.into());
        s.current_message = message.into();
    });
    emit_progress(app, true);
    if let Err(e) = run_extract(bin, &dcb_extract_args(p4k, &out.display().to_string(), filter)) {
        check_cancel()?; // annulation → propage
        eprintln!("[datamining] extract non-fatal '{filter}' : {e}");
    }
    Ok(())
}

/* ─────────────────────────────── Séquence V1 ──────────────────────────────── */

pub(crate) fn run_sequence(app: &AppHandle, bin: &Path, p4k: &str, temp: &Path) -> Result<(), String> {
    // ── Phase 1 — noms de classes vaisseaux (SC Wiki) — 0→5 % ──
    update_status(|s| {
        s.phase = Some("fetching_classnames".into());
        s.current_message = "Récupération de la liste des vaisseaux…".into();
        s.percent_overall = 0.0;
    });
    emit_progress(app, true);
    let class_names = fetch_class_names()?;
    update_status(|s| s.percent_overall = 5.0);
    emit_progress(app, true);

    // ── Phase 2 — dcb query par vaisseau → ships/<class>.json — 5→100 % ──
    let ships_dir = temp.join("ships");
    fs::create_dir_all(&ships_dir).map_err(|e| e.to_string())?;
    let total = class_names.len();
    let mut done = 0usize;
    let mut fail = 0usize;
    let phase2_start = Instant::now();
    update_status(|s| {
        s.phase = Some("querying_ships".into());
        s.current_message = format!("0/{total}");
    });
    emit_progress(app, true);

    for class_name in &class_names {
        check_cancel()?;
        match run_capture(bin, &dcb_query_args(class_name, p4k)) {
            Ok(stdout) => {
                if let Some(record) = parse_exact_record(&stdout, class_name) {
                    let _ = fs::write(ships_dir.join(format!("{class_name}.json")), record);
                }
            }
            Err(e) => {
                check_cancel()?; // kill par annulation → propage
                fail += 1;
                eprintln!("[datamining] dcb query échoué '{class_name}' : {e}");
                if total > 0 && (fail as f64 / total as f64) > MAX_FAIL_RATIO {
                    return Err(format!(
                        "Extraction abandonnée : {fail}/{total} requêtes échouées (>{}%)",
                        (MAX_FAIL_RATIO * 100.0) as i64
                    ));
                }
            }
        }
        done += 1;
        if done.is_multiple_of(5) || done == total {
            let elapsed = phase2_start.elapsed().as_secs_f64();
            let rate = if elapsed > 0.0 { done as f64 / elapsed } else { 0.0 };
            let eta = if rate > 0.0 {
                Some(((total.saturating_sub(done)) as f64 / rate).round() as i64)
            } else {
                None
            };
            let pct = if total > 0 {
                5.0 + (done as f64 / total as f64) * 95.0
            } else {
                100.0
            };
            update_status(|s| {
                s.percent_overall = pct;
                s.eta_seconds = eta;
                s.current_message = format!("{done}/{total}");
            });
            emit_progress(app, false);
        }
    }

    // ── Phase 3 — global.ini (p4k extract, EN + FR dans la même passe) ──
    check_cancel()?;
    update_status(|s| {
        s.phase = Some("extracting_localization".into());
        s.current_message = "Extraction de la localisation…".into();
    });
    emit_progress(app, true);
    if let Err(e) = run_extract(bin, &p4k_extract_args(p4k, &temp.display().to_string(), FILTER_GLOBAL_INI)) {
        check_cancel()?;
        eprintln!("[datamining] global.ini non-fatal : {e}");
    }

    // ── Phase 4 — contractgenerator (missions) ──
    extract_subtree(
        app, bin, p4k, &temp.join("contracts_dump"), FILTER_CONTRACTS,
        "extracting_contracts", "Extraction des contrats…",
    )?;

    // ── Phase 5 — blueprints/crafting ──
    extract_subtree(
        app, bin, p4k, &temp.join("blueprints_dump"), FILTER_BLUEPRINTS,
        "extracting_blueprints", "Extraction des blueprints…",
    )?;

    // ── Phase 5b — blueprintrewards ──
    extract_subtree(
        app, bin, p4k, &temp.join("blueprint_rewards_dump"), FILTER_BLUEPRINT_REWARDS,
        "extracting_blueprint_rewards", "Extraction des récompenses de blueprints…",
    )?;

    // ── Phase 6 — mining (4 sous-arbres dans le MÊME mining_dump) ──
    check_cancel()?;
    update_status(|s| {
        s.phase = Some("extracting_mining".into());
        s.current_message = "Extraction des données de minage…".into();
    });
    emit_progress(app, true);
    let mining_dump = temp.join("mining_dump");
    for filter in FILTER_MINING {
        check_cancel()?;
        if let Err(e) = run_extract(bin, &dcb_extract_args(p4k, &mining_dump.display().to_string(), filter)) {
            check_cancel()?;
            eprintln!("[datamining] mining non-fatal '{filter}' : {e}");
        }
    }

    // ── Phase 7 — scitem ──
    extract_subtree(
        app, bin, p4k, &temp.join("scitem_dump"), FILTER_SCITEM,
        "extracting_scitem", "Extraction du corpus scitem…",
    )?;

    Ok(())
}

pub(crate) fn cleanup(temp: &Path) {
    let _ = fs::remove_dir_all(temp);
}

/// Supprime les anciens dossiers de dumps `scfleet-datamining-*` du dossier temp (sauf
/// `keep`) → évite l'accumulation sur disque (seule la dernière extraction est conservée,
/// car elle reste exploitable par les commandes d'apply autonomes).
pub(crate) fn purge_old_dumps(keep: &Path) {
    if let Ok(entries) = fs::read_dir(std::env::temp_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            if p == keep || !p.is_dir() {
                continue;
            }
            let is_dump = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("scfleet-datamining-"))
                .unwrap_or(false);
            if is_dump {
                let _ = fs::remove_dir_all(&p);
            }
        }
    }
}

/* ───────────────────────── Apply (enchaîné après extraction) ───────────────── */
// Réutilise les 3 fonctions *_core de datamining.rs (déjà paramétrées par dump_dir),
// en les pointant sur le dossier d'extraction du Lot 1 (au lieu de STABLE_DUMP_DIR).
// Indépendantes en V2 (mining/starmap résolvent les noms depuis mining_dump, pas la DB ;
// enrich_blueprint_stats met à jour les CraftingBlueprint existants). Ordre arbitraire mais
// stable : starmap → mining → stats. Une erreur d'un _core (dump incomplet) remonte.

pub(crate) fn run_apply(app: &AppHandle, temp: &Path) -> Result<(), String> {
    let dump = temp.to_string_lossy().to_string();

    // NB : on N'applique PLUS la carte galactique depuis le datamining ici — la carte est
    // désormais 100 % Wiki (sync_starmap_from_wiki). Lancer le starmap datamining écraserait
    // les coordonnées Wiki. L'extraction ne touche donc plus StarmapBody.

    check_cancel()?;
    update_status(|s| {
        s.phase = Some("applying".into());
        s.current_message = "Application : localisations de minage…".into();
    });
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::sync_mining_locations_core(app, &dump))?;

    check_cancel()?;
    update_status(|s| s.current_message = "Application : stats de craft…".into());
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::enrich_blueprint_stats_core(app, &dump))?;

    check_cancel()?;
    update_status(|s| s.current_message = "Application : noms FR des blueprints…".into());
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::backfill_blueprint_names_fr_core(app, &dump))?;

    Ok(())
}

/* ─────────────────────────── AppMeta + validation chemin ───────────────────── */

/// Lit le chemin d'install configuré (AppMeta `datamining.scInstallPath`). None si vide/absent.
pub(crate) async fn read_configured_install(app: &AppHandle) -> Option<String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL)?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return None,
    };
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(SC_INSTALL_KEY)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .filter(|s| !s.trim().is_empty())
}

pub(crate) async fn meta_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    sqlx::query("INSERT OR REPLACE INTO AppMeta (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) async fn meta_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    sqlx::query("DELETE FROM AppMeta WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Validation d'un dossier d'install (réplique V1 validatePath) : Data.p4k + Game.log
/// (ou au moins un logbackups/*.log).
pub(crate) fn validate_path_fs(path: &str) -> (bool, bool) {
    let p = Path::new(path);
    let has_p4k = p.join("Data.p4k").is_file();
    let has_game_log = p.join("Game.log").is_file() || logbackups_has_log(p);
    (has_p4k, has_game_log)
}

pub(crate) fn logbackups_has_log(install: &Path) -> bool {
    fs::read_dir(install.join("logbackups"))
        .map(|rd| {
            rd.flatten().any(|e| {
                e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("log"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}
