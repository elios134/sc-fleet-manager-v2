// Noms français des objets fabriqués (CraftingBlueprint.producedItemNameFr) depuis le pack de
// traduction installé dans le jeu (<install>/data/Localization/<langue>/global.ini). Le wiki ne
// traduit pas les noms ; ce fichier donne en plus les noms que le joueur voit en jeu (utile au
// rapprochement avec le Game.log). Remplace la lecture des dumps du Data.p4k.
use super::*;
use std::collections::HashMap;

/// global.ini → table clé (minuscules) → valeur.
pub(crate) fn parse_ini(text: &str) -> HashMap<String, String> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .filter(|l| !l.trim_start().starts_with(';'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect()
}

/// Nom FR d'un objet d'après sa classe (`item_Name<classe>` ou `item_Name_<classe>`).
pub(crate) fn fr_name_for_class(ini: &HashMap<String, String>, class: &str) -> Option<String> {
    let c = class.trim().to_lowercase();
    if c.is_empty() {
        return None;
    }
    [format!("item_name{c}"), format!("item_name_{c}")]
        .iter()
        .filter_map(|k| ini.get(k))
        .find(|v| !v.is_empty() && !v.starts_with('@') && !v.contains("TRANSLATION NOT FOUND"))
        .cloned()
}

/// Pose les noms FR trouvés ; un nom introuvable laisse la valeur existante. Renvoie le nombre
/// de plans mis à jour. Jeu introuvable ou pas de pack installé → Ok(0).
pub(crate) async fn apply_fr_names(app: &AppHandle) -> Result<usize, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = lock.get(DB_URL) else {
        return Err(format!("Base de données non chargée : {DB_URL}"));
    };
    let configured = crate::commands::app_meta::get(pool, crate::commands::sc_install::SC_INSTALL_KEY).await;
    let Some((install, _channel)) = crate::commands::patch_detect::resolve_sc_install(configured) else {
        return Ok(0);
    };
    let root = std::path::Path::new(&install);
    let lang = std::fs::read_to_string(root.join("user.cfg"))
        .ok()
        .and_then(|cfg| crate::commands::translation::cfg::current_language(&cfg))
        .unwrap_or_else(|| "french_(france)".to_string());
    let Ok(text) = std::fs::read_to_string(root.join("data").join("Localization").join(&lang).join("global.ini")) else {
        return Ok(0);
    };
    let ini = parse_ini(&text);

    let rows = sqlx::query("SELECT id, producedItemEntityClass FROM CraftingBlueprint WHERE producedItemEntityClass IS NOT NULL")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut written = 0usize;
    for r in &rows {
        let (Ok(id), Ok(class)) = (r.try_get::<String, _>("id"), r.try_get::<String, _>("producedItemEntityClass")) else {
            continue;
        };
        if let Some(fr) = fr_name_for_class(&ini, &class) {
            sqlx::query("UPDATE CraftingBlueprint SET producedItemNameFr = ? WHERE id = ?")
                .bind(&fr)
                .bind(&id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            written += 1;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(written)
}

/// Réglages › Diagnostic (dev) : relance la pose des noms FR sans resynchroniser le wiki.
#[tauri::command]
pub async fn refresh_fr_names(app: AppHandle) -> Result<usize, String> {
    apply_fr_names(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "\u{feff}item_NameAMRS_LaserCannon_S1=Canon laser Omnisky III\r\n\
                       item_Name_behr_lmg_ballistic_01=Mitrailleuse FS-9\r\n\
                       item_Name_vide=\r\n\
                       item_Name_absente=! FRENCH_(FRANCE) TRANSLATION NOT FOUND FOR LOCID: x !\r\n\
                       ; commentaire=ignoré\r\n\
                       item_Name_egal=a=b\r\n";

    #[test]
    fn lit_le_fichier_sans_bom_ni_casse() {
        let m = parse_ini(INI);
        assert_eq!(m.get("item_nameamrs_lasercannon_s1").map(String::as_str), Some("Canon laser Omnisky III"));
        assert_eq!(m.get("item_name_egal").map(String::as_str), Some("a=b"));
        assert!(!m.contains_key("; commentaire"));
    }

    #[test]
    fn deux_formes_de_cle() {
        let m = parse_ini(INI);
        assert_eq!(fr_name_for_class(&m, "amrs_lasercannon_s1").as_deref(), Some("Canon laser Omnisky III"));
        assert_eq!(fr_name_for_class(&m, "BEHR_LMG_Ballistic_01").as_deref(), Some("Mitrailleuse FS-9"));
    }

    #[test]
    fn valeur_vide_ou_non_traduite_ignoree() {
        let m = parse_ini(INI);
        assert_eq!(fr_name_for_class(&m, "vide"), None);
        assert_eq!(fr_name_for_class(&m, "absente"), None);
        assert_eq!(fr_name_for_class(&m, "inconnue"), None);
        assert_eq!(fr_name_for_class(&m, ""), None);
    }
}
