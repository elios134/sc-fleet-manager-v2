// Re-cochage des plans débloqués d'après le Game.log (et les logbackups).
use super::*;

/* ───────────────────────── Re-cochage via Game.log ─────────────────────────
   Détecte les blueprints débloqués en jeu en lisant Game.log (+ logbackups) et
   coche les blueprints correspondants (ADD-ONLY). Logique de parsing portée de V1
   (blueprintLogParser.ts). Matching sur producedItemName (EN) — producedItemNameFr
   étant vide en V2 (cf. audit) ; les noms FR traduits restent « non appariés ».      */

/// Extrait les noms de produits débloqués depuis le texte d'un Game.log (port V1).
/// Normalise un nom pour le matching tolérant Game.log ↔ base :
/// minuscule, tout espace Unicode (dont NBSP `\u{00A0}` / NNBSP `\u{202F}` des
/// noms FR du global.ini) ramené à un espace simple + collapse, et retrait des
/// guillemets/parenthèses (le jeu loggue `"Warhawk"` là où la base a `(Warhawk)`).
/// Sûr : ne fusionne pas d'items distincts (ambiguïté globale 35→33 sur la base).
pub(crate) fn norm_match(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars().flat_map(char::to_lowercase) {
        match c {
            '"' | '\'' | '\u{201C}' | '\u{201D}' | '\u{00AB}' | '\u{00BB}' | '(' | ')' => continue,
            c if c.is_whitespace() => {
                if !out.is_empty() {
                    pending_space = true;
                }
            }
            c => {
                if pending_space {
                    out.push(' ');
                    pending_space = false;
                }
                out.push(c);
            }
        }
    }
    out
}

/// Ligne primaire = contient `<SHUDEvent_OnNotification>` ET `Added notification "<txt>" [<id>]`,
/// dont `<txt>` matche « Received Blueprint: <nom>: » (EN) ou « Schémas reçu(s) : <nom>: » (FR).
pub(crate) fn parse_blueprint_unlocks(text: &str, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>) {
    use regex::Regex;
    // Compilées à chaque appel de fichier (volume modeste : Game.log + quelques backups).
    let notif_re = Regex::new(r#"Added notification "(.*?)"\s*\[(\d+)\]"#).expect("notif regex");
    let product_re =
        Regex::new(r"(?:Received Blueprint: (.+?):|Sch[eé]mas? reçus? : (.+?):)").expect("product regex");
    for line in text.lines() {
        if !line.contains("<SHUDEvent_OnNotification>") {
            continue;
        }
        let Some(caps) = notif_re.captures(line) else { continue };
        let quoted = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let Some(pcaps) = product_re.captures(quoted) else { continue };
        let name = pcaps
            .get(1)
            .or_else(|| pcaps.get(2))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(name) = name {
            let key = name.to_lowercase();
            if seen.insert(key) {
                out.push(name);
            }
        }
    }
}

/// Lecture LOSSY (port de V1 readLossy) : les Game.log SC ne sont PAS de l'UTF-8 strict
/// (octets invalides épars) → `read_to_string` échouerait sur tout le fichier (→ 0 détecté).
/// On lit les octets et on décode en remplaçant les invalides (le « é » UTF-8 c3a9 reste
/// intact), puis on retire un éventuel BOM.
pub(crate) fn read_lossy(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let s = String::from_utf8_lossy(&bytes).into_owned();
    Some(s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s))
}

/// Lit Game.log + logbackups/*.log à la racine de l'install et renvoie les noms distincts
/// de blueprints débloqués. Liste vide si install/log introuvable.
pub(crate) fn detect_unlocked_names(install_path: &str) -> Vec<String> {
    use std::path::Path;
    let root = Path::new(install_path);
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(text) = read_lossy(&root.join("Game.log")) {
        parse_blueprint_unlocks(&text, &mut out, &mut seen);
    }
    if let Ok(entries) = std::fs::read_dir(root.join("logbackups")) {
        let mut backups: Vec<std::path::PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("log")).unwrap_or(false))
            .collect();
        backups.sort();
        for p in backups {
            if let Some(text) = read_lossy(&p) {
                parse_blueprint_unlocks(&text, &mut out, &mut seen);
            }
        }
    }
    out
}

/// Re-coche les blueprints débloqués en jeu (lecture Game.log). Matching EN sur
/// producedItemName (insensible casse) ; ambigus (>1) ignorés ; ADD-ONLY (jamais décoché).
/// Renvoie un récap + la liste des noms non appariés (perte due à la traduction FR).
#[tauri::command]
pub async fn resync_blueprints_from_log(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    if account_id.trim().is_empty() {
        return Err("Aucun compte actif.".into());
    }
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Chemin d'install (chemin manuel AppMeta prioritaire, sinon cascade).
    let configured = sqlx::query("SELECT value FROM AppMeta WHERE key = 'datamining.scInstallPath'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok());
    let install = crate::commands::patch_detect::resolve_sc_install(configured);
    let Some((install_path, _channel)) = install else {
        return Ok(json!({
            "logFound": false, "detected": 0, "alreadyOwned": 0,
            "newlyChecked": 0, "ambiguousSkipped": 0, "unmatched": 0, "unmatchedNames": [],
        }));
    };

    let detected = detect_unlocked_names(&install_path);
    if detected.is_empty() {
        return Ok(json!({
            "logFound": true, "detected": 0, "alreadyOwned": 0,
            "newlyChecked": 0, "ambiguousSkipped": 0, "unmatched": 0, "unmatchedNames": [],
        }));
    }

    // Index nom (minuscule) → ids DISTINCTS de blueprints. On indexe le nom EN ET
    // le nom FR (producedItemNameFr, s'il existe) vers le MÊME id : un log EN ou FR
    // matche ainsi le bon blueprint. >1 id DISTINCT pour un nom = ambiguïté réelle ;
    // EN + FR d'un même BP partagent le même id → ce n'est PAS une ambiguïté.
    fn index_name(map: &mut HashMap<String, Vec<String>>, raw: &str, id: &str) {
        let key = norm_match(raw);
        if key.is_empty() || id.is_empty() {
            return;
        }
        let ids = map.entry(key).or_default();
        if !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    }

    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    let bp_rows = sqlx::query(
        "SELECT id, producedItemName, producedItemNameFr FROM CraftingBlueprint \
         WHERE (producedItemName IS NOT NULL AND producedItemName <> '') \
            OR (producedItemNameFr IS NOT NULL AND producedItemNameFr <> '')",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    for r in &bp_rows {
        let id: String = r.try_get("id").unwrap_or_default();
        // Nom EN (inchangé : zéro régression) puis nom FR (si non NULL).
        if let Some(en) = r.try_get::<Option<String>, _>("producedItemName").ok().flatten() {
            index_name(&mut by_name, &en, &id);
        }
        if let Some(fr) = r.try_get::<Option<String>, _>("producedItemNameFr").ok().flatten() {
            index_name(&mut by_name, &fr, &id);
        }
    }

    // Alias manuels (nom de log → blueprint), mappés par l'utilisateur pour les noms
    // que l'auto-matching ne couvre pas (renommages entre patchs, FR non traduit…).
    // AUTORITAIRES : on écrase l'entrée pour ce nom → toujours 1 seul id, jamais ambigu.
    let aliases_raw = sqlx::query("SELECT value FROM AppMeta WHERE key = 'crafting.blueprintLogAliases'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok());
    if let Some(json) = aliases_raw {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) {
            for (raw_name, bp_id) in map {
                let key = norm_match(&raw_name);
                if !key.is_empty() && !bp_id.trim().is_empty() {
                    by_name.insert(key, vec![bp_id]);
                }
            }
        }
    }

    // Déjà possédés (compte actif).
    let owned_rows = sqlx::query("SELECT blueprintId FROM UserCraftingBlueprintOwned WHERE accountId = ?")
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let owned: std::collections::HashSet<String> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("blueprintId").ok())
        .collect();

    let mut already_owned = 0i64;
    let mut newly_checked = 0i64;
    let mut ambiguous_skipped = 0i64;
    let mut unmatched_names: Vec<String> = Vec::new();

    for name in &detected {
        match by_name.get(&norm_match(name)) {
            None => unmatched_names.push(name.clone()),
            Some(ids) if ids.len() > 1 => ambiguous_skipped += 1,
            Some(ids) => {
                let id = &ids[0];
                if owned.contains(id) {
                    already_owned += 1;
                } else {
                    // ADD-ONLY : INSERT OR IGNORE (jamais de décochage).
                    sqlx::query(
                        "INSERT OR IGNORE INTO UserCraftingBlueprintOwned (accountId, blueprintId, createdAt)
                         VALUES (?, ?, datetime('now'))",
                    )
                    .bind(&account_id)
                    .bind(id)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    newly_checked += 1;
                }
            }
        }
    }

    Ok(json!({
        "logFound": true,
        "detected": detected.len(),
        "alreadyOwned": already_owned,
        "newlyChecked": newly_checked,
        "ambiguousSkipped": ambiguous_skipped,
        "unmatched": unmatched_names.len(),
        "unmatchedNames": unmatched_names,
    }))
}
