// Synchro UEX du marché des vaisseaux (points d'achat et de location in-game).
use super::*;

/* ═══════════════════════════ SYNC 2 — marché vaisseaux ═══════════════════════════ */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VehicleSyncReport {
    pub purchase_points: i64,
    pub rental_points: i64,
    pub vehicles_purchase: i64,
    pub vehicles_rental: i64,
}

/// Sync UEX : /vehicles (noms) + /vehicles_purchases_prices + /vehicles_rentals_prices →
/// peuple VehiclePurchasePrice / VehicleRentalPrice (aUEC in-game, géolocalisés).
#[tauri::command]
pub async fn sync_vehicle_marketplace(app: AppHandle) -> Result<VehicleSyncReport, String> {
    let mut report = VehicleSyncReport::default();
    let client = uex_client()?;

    let vehicles = get_data(&client, "vehicles").await?;
    let purchases = get_data(&client, "vehicles_purchases_prices").await?;
    let rentals = get_data(&client, "vehicles_rentals_prices").await?;
    if vehicles.is_empty() || (purchases.is_empty() && rentals.is_empty()) {
        return Err("UEX vaisseaux : données vides — tables conservées".into());
    }

    // id_vehicle → nom COURT (UEX `name`, ex. "100i") qui matche ShipData.name pour la
    // jointure des specs/rôle. `name_full` ("Origin 100i") inclut le fabricant → ne matche pas.
    let mut veh_name: HashMap<i64, String> = HashMap::new();
    for v in &vehicles {
        if let (Some(id), Some(name)) = (vi64(v, "id"), vstr(v, "name").or_else(|| vstr(v, "name_full"))) {
            veh_name.insert(id, name);
        }
    }
    let name_of = |id: Option<i64>| -> Option<String> { id.and_then(|i| veh_name.get(&i).cloned()) };

    let mut pv: HashSet<i64> = HashSet::new();
    let mut rv: HashSet<i64> = HashSet::new();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM VehiclePurchasePrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM VehicleRentalPrice").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for p in &purchases {
        let Some(id) = vi64(p, "id") else { continue };
        let id_vehicle = vi64(p, "id_vehicle");
        if let Some(v) = id_vehicle {
            pv.insert(v);
        }
        sqlx::query(
            "INSERT OR REPLACE INTO VehiclePurchasePrice
               (id, idVehicle, vehicleName, idTerminal, terminalName, priceBuy,
                starSystemName, planetName, orbitName, moonName, cityName, outpostName,
                spaceStationName, dateModified, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(id_vehicle)
        .bind(name_of(id_vehicle))
        .bind(vi64(p, "id_terminal"))
        .bind(vstr(p, "terminal_name"))
        .bind(vf64(p, "price_buy"))
        .bind(vstr(p, "star_system_name"))
        .bind(vstr(p, "planet_name"))
        .bind(vstr(p, "orbit_name"))
        .bind(vstr(p, "moon_name"))
        .bind(vstr(p, "city_name"))
        .bind(vstr(p, "outpost_name"))
        .bind(vstr(p, "space_station_name"))
        .bind(vi64(p, "date_modified"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.purchase_points += 1;
    }

    for r in &rentals {
        let Some(id) = vi64(r, "id") else { continue };
        let id_vehicle = vi64(r, "id_vehicle");
        if let Some(v) = id_vehicle {
            rv.insert(v);
        }
        sqlx::query(
            "INSERT OR REPLACE INTO VehicleRentalPrice
               (id, idVehicle, vehicleName, idTerminal, terminalName, priceRent,
                starSystemName, planetName, orbitName, moonName, cityName, outpostName,
                spaceStationName, dateModified, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(id)
        .bind(id_vehicle)
        .bind(name_of(id_vehicle))
        .bind(vi64(r, "id_terminal"))
        .bind(vstr(r, "terminal_name"))
        .bind(vf64(r, "price_rent"))
        .bind(vstr(r, "star_system_name"))
        .bind(vstr(r, "planet_name"))
        .bind(vstr(r, "orbit_name"))
        .bind(vstr(r, "moon_name"))
        .bind(vstr(r, "city_name"))
        .bind(vstr(r, "outpost_name"))
        .bind(vstr(r, "space_station_name"))
        .bind(vi64(r, "date_modified"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        report.rental_points += 1;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    report.vehicles_purchase = pv.len() as i64;
    report.vehicles_rental = rv.len() as i64;
    eprintln!(
        "[catalog] VAISSEAUX — achat {} pts ({} vaisseaux) | location {} pts ({} vaisseaux)",
        report.purchase_points, report.vehicles_purchase, report.rental_points, report.vehicles_rental
    );
    Ok(report)
}
