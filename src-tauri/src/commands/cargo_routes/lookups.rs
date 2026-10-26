// Listes pour les sélecteurs : vaisseaux de la flotte, catalogue cargo, hiérarchie des lieux.

use super::*;

/// Vaisseaux de la flotte du compte actif, avec capacité SCU (catalogue), triés cargo
/// décroissant (les plus gros porteurs d'abord) pour le sélecteur du planificateur.
#[tauri::command]
pub async fn get_cargo_fleet_ships(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let active = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());
    let Some(account_id) = active else {
        return Ok(serde_json::json!([]));
    };

    let rows = sqlx::query(
        "SELECT s.name AS name, s.manufacturer AS manufacturer, sd.cargoScu AS cargoScu, sd.role AS role,
                sd.quantumRange AS quantumRange
           FROM Ship s
           LEFT JOIN ShipData sd ON sd.name = s.name COLLATE NOCASE
          WHERE s.accountId = ?
          ORDER BY (sd.cargoScu IS NULL) ASC, sd.cargoScu DESC, s.name ASC",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Dédup par nom (un même modèle possédé en plusieurs exemplaires = une seule entrée).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for r in &rows {
        let name: String = r.try_get("name").unwrap_or_default();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        out.push(serde_json::json!({
            "name": name,
            "manufacturer": r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
            "cargoScu": r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
            "role": r.try_get::<Option<String>, _>("role").ok().flatten(),
            // Autonomie quantique (Gm) : carte stellaire (itinéraire, carburant).
            "quantumRangeGm": r.try_get::<Option<f64>, _>("quantumRange").ok().flatten(),
        }));
    }
    Ok(Value::Array(out))
}

/// TOUS les vaisseaux cargo du catalogue (ShipData.cargoScu > 0), triés cargo décroissant.
/// Pour le groupe « Tous les vaisseaux cargo » du sélecteur (stats QT par défaut = drive
/// stock, résolu par find_cargo_routes comme pour la flotte). `qtDefault` = a-t-on un QT
/// stock résolvable (sinon profit/min indisponible → marge brute).
#[tauri::command]
pub async fn get_cargo_catalog_ships(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    let rows = sqlx::query(
        "SELECT sd.name AS name, sd.manufacturer AS manufacturer, sd.cargoScu AS cargoScu, sd.role AS role,
                EXISTS (SELECT 1 FROM ShipHardpoint h JOIN Component c ON c.className = h.defaultComponentClassName
                        WHERE h.shipId = sd.id AND h.type = 'QUANTUM_DRIVE' AND c.qtDriveSpeed IS NOT NULL) AS qtDefault
           FROM ShipData sd
          WHERE sd.cargoScu > 0
          ORDER BY sd.cargoScu DESC, sd.name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for r in &rows {
        let name: String = r.try_get("name").unwrap_or_default();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        out.push(serde_json::json!({
            "name": name,
            "manufacturer": r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
            "cargoScu": r.try_get::<Option<i64>, _>("cargoScu").ok().flatten(),
            "role": r.try_get::<Option<String>, _>("role").ok().flatten(),
            "qtDefault": r.try_get::<i64, _>("qtDefault").unwrap_or(0) != 0,
        }));
    }
    Ok(Value::Array(out))
}

/* ════════════ Modale « Détails de la route » — hiérarchie d'un lieu ═══════════ */
// Reconstitue la chaîne de parenté d'un lieu (Système → Planète → [Lune] → Lieu) par
// remontées successives de parentSlug dans WikiStarmapLocation (parent DIRECT seulement
// en base, mais chaîne complète reconstituable). web_url déterministe depuis le slug.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyNode {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub type_class: Option<String>,
    pub designation: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationHierarchy {
    pub system: Option<String>,
    pub levels: Vec<HierarchyNode>, // haut → bas, étoile racine retirée
}

/// web_url officiel SC Wiki, déterministe depuis le slug (vérifié : /locations/{slug}).
pub(super) fn wiki_web_url(slug: &str) -> String {
    format!("https://api.star-citizen.wiki/locations/{slug}")
}

/// Chaîne de parenté d'un lieu (par uuid Wiki). Niveau manquant → chaîne partielle, jamais d'erreur.
#[tauri::command]
pub async fn get_location_hierarchy(
    uuid: String,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<LocationHierarchy, String> {
    let instances = db_instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(instances);

    // Lieu de départ (par uuid) → slug + système.
    let start = sqlx::query("SELECT slug, systemName FROM WikiStarmapLocation WHERE uuid = ? LIMIT 1")
        .bind(&uuid)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let Some(start) = start else {
        return Ok(LocationHierarchy { system: None, levels: Vec::new() });
    };
    let system: Option<String> = start.try_get::<Option<String>, _>("systemName").ok().flatten();
    let mut cur_slug: Option<String> = start.try_get::<Option<String>, _>("slug").ok().flatten();

    // Remontée bottom→top via parentSlug (garde-fou anti-boucle).
    let mut chain: Vec<HierarchyNode> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    while let Some(slug) = cur_slug.clone() {
        if slug.is_empty() || !seen.insert(slug.clone()) {
            break;
        }
        let row = sqlx::query(
            "SELECT name, slug, typeClassification, designation, parentSlug
               FROM WikiStarmapLocation WHERE slug = ? LIMIT 1",
        )
        .bind(&slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        let Some(row) = row else { break };
        let node_slug: Option<String> = row.try_get::<Option<String>, _>("slug").ok().flatten();
        chain.push(HierarchyNode {
            name: row.try_get::<Option<String>, _>("name").ok().flatten(),
            web_url: node_slug.as_deref().map(wiki_web_url),
            slug: node_slug,
            type_class: row.try_get::<Option<String>, _>("typeClassification").ok().flatten(),
            designation: row.try_get::<Option<String>, _>("designation").ok().flatten(),
        });
        cur_slug = row.try_get::<Option<String>, _>("parentSlug").ok().flatten();
        if chain.len() > 16 {
            break; // sécurité
        }
    }

    // Retire l'étoile racine (le système est affiché à part), puis haut → bas.
    if matches!(chain.last().and_then(|n| n.type_class.as_deref()), Some("Star")) {
        chain.pop();
    }
    chain.reverse();

    Ok(LocationHierarchy { system, levels: chain })
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
