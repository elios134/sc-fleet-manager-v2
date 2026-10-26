// Enregistrement d'un loadout (commande save_loadout).

use super::*;

/* ───────────────────────────────  save_loadout  ──────────────────────────── */

#[tauri::command]
#[allow(unused_variables)]
pub async fn save_loadout(
    ship_id: i64,
    profile_name: String,
    account_id: String,
    slots: Vec<Value>,
    db_instances: State<'_, DbInstances>,
) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Défense en profondeur : un vaisseau loué a un loadout de base NON modifiable.
    let acquisition: Option<String> = sqlx::query("SELECT acquisition FROM Ship WHERE id = ?")
        .bind(ship_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<Option<String>, _>("acquisition").ok().flatten());
    if acquisition.as_deref() == Some("rented") {
        return Err("Loadout non modifiable pour un vaisseau loué.".into());
    }

    let loadout_id = sqlx::query(
        "INSERT INTO Loadout (shipId, profileName, createdAt, updatedAt)
         VALUES (?, ?, datetime('now'), datetime('now'))
         RETURNING id",
    )
    .bind(ship_id)
    .bind(&profile_name)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .try_get::<i64, _>("id")
    .map_err(|e| e.to_string())?;

    for slot in &slots {
        let slot_type = val_str(slot, "slotType").unwrap_or_default();
        let slot_size = val_i64(slot, "slotSize").unwrap_or(1);
        sqlx::query(
            "INSERT INTO LoadoutSlot (loadoutId, slotType, slotSize, componentName,
                                      componentGrade, componentMake, portName, componentClassName,
                                      hardpointId, parentId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(loadout_id)
        .bind(&slot_type)
        .bind(slot_size)
        .bind(val_str(slot, "componentName"))
        .bind(val_str(slot, "componentGrade"))
        .bind(val_str(slot, "componentMake"))
        .bind(val_str(slot, "portName"))
        .bind(val_str(slot, "componentClassName"))
        .bind(val_i64(slot, "hardpointId"))
        .bind(val_i64(slot, "parentId"))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(loadout_id)
}

/* ──────────────────────────────  delete_loadout  ─────────────────────────── */
