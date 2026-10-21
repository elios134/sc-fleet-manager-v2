// Backfill des noms FR de blueprint (producedItemNameFr) depuis global.ini.
use super::*;

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
pub(crate) fn find_loc_name_key(v: &Value) -> Option<String> {
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
