// Synchro Wiki des vaisseaux : upsert ShipData, hardpoints, radar tactique, baseDps.
use super::*;

/* ──────────────────────────────  Upsert ShipData  ─────────────────────────── */

/// Mappe un vaisseau SC Wiki (objet `data` du détail) → ShipData et upsert par `wikiId`.
/// Réplique exacte du mapping V1 (mapVehicleToShipData). Renvoie Some(id ShipData) si
/// écrit, None si ignoré (pas de nom). L'id sert à rattacher les hardpoints (Phase 2b).
pub(crate) async fn upsert_vehicle(app: &AppHandle, v: &Value) -> Result<Option<i64>, String> {
    let Some(name) = vstr(v, "name") else {
        return Ok(None);
    };

    let wiki_id = vstr(v, "uuid");
    let rsi_ship_id = vi64(v, "id");
    let wiki_version = vstr(v, "version");
    let manufacturer = v
        .get("manufacturer")
        .and_then(|m| vstr(m, "name"))
        .unwrap_or_default();
    let role = vstr(v, "career").unwrap_or_default(); // career → role
    let classification = vstr(v, "role").unwrap_or_default(); // role → classification
    let focus = extract_focus(v);
    let size = v.get("sizes").and_then(|s| vstr(s, "class"));
    let length = v.get("sizes").and_then(|s| vf64(s, "length"));
    let beam = v.get("sizes").and_then(|s| vf64(s, "beam"));
    let height = v.get("sizes").and_then(|s| vf64(s, "height"));
    let max_speed = v.get("speed").and_then(|s| vf64(s, "max"));
    let scm_speed = v.get("speed").and_then(|s| vf64(s, "scm"));
    let hull_hp = vf64(v, "health");
    let shield_hp = v.get("shield").and_then(|s| vf64(s, "hp"));
    let cargo_scu = vf64(v, "cargo_capacity").map(|x| x as i64);
    let crew_min = v.get("crew").and_then(|c| vi64(c, "min"));
    let crew_max = v.get("crew").and_then(|c| vi64(c, "max"));
    let mass = vf64(v, "mass_hull");
    let msrp_usd = vf64(v, "msrp").map(|x| x as i64);
    let image_url = v
        .get("images")
        .and_then(|i| i.as_array())
        .and_then(|a| a.first())
        .and_then(|img| vstr(img, "original_url"));
    let em_signature = v.get("emission").and_then(|e| vf64(e, "em_idle"));
    let ir_signature = v.get("emission").and_then(|e| vf64(e, "ir"));
    let cross_section = vf64(v, "cross_section_max");
    let class_name_cig = vstr(v, "class_name");
    let pitch_rate = v.get("agility").and_then(|a| vf64(a, "pitch"));
    let yaw_rate = v.get("agility").and_then(|a| vf64(a, "yaw"));
    let roll_rate = v.get("agility").and_then(|a| vf64(a, "roll"));
    // Carburant quantique (objet `quantum` du détail vaisseau v2) : capacité réservoir (SCU)
    // + autonomie max DÉJÀ calculée par l'API en MÈTRES → stockée en Gm (cohérent distanceGm).
    let quantum_fuel = v.get("quantum").and_then(|q| vf64(q, "quantum_fuel_capacity"));
    let quantum_range = v
        .get("quantum")
        .and_then(|q| vf64(q, "quantum_range"))
        .map(|m| m / 1.0e9);

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query(
        "INSERT INTO ShipData
           (wikiId, rsiShipId, wikiVersion, name, manufacturer, role, classification, focus,
            size, length, beam, height, maxSpeed, scmSpeed, hullHp, shieldHp, cargoScu,
            crewMin, crewMax, mass, msrpUsd, imageUrl, emSignature, irSignature, crossSection,
            classNameCig, pitchRate, yawRate, rollRate, quantumFuel, quantumRange, source, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'wiki', datetime('now'))
         ON CONFLICT(wikiId) DO UPDATE SET
           rsiShipId=excluded.rsiShipId, wikiVersion=excluded.wikiVersion, name=excluded.name,
           manufacturer=excluded.manufacturer, role=excluded.role,
           classification=excluded.classification, focus=excluded.focus, size=excluded.size,
           length=excluded.length, beam=excluded.beam, height=excluded.height,
           maxSpeed=excluded.maxSpeed, scmSpeed=excluded.scmSpeed, hullHp=excluded.hullHp,
           shieldHp=excluded.shieldHp, cargoScu=excluded.cargoScu, crewMin=excluded.crewMin,
           crewMax=excluded.crewMax, mass=excluded.mass, msrpUsd=excluded.msrpUsd,
           imageUrl=excluded.imageUrl, emSignature=excluded.emSignature,
           irSignature=excluded.irSignature, crossSection=excluded.crossSection,
           classNameCig=excluded.classNameCig, pitchRate=excluded.pitchRate,
           yawRate=excluded.yawRate, rollRate=excluded.rollRate,
           quantumFuel=excluded.quantumFuel, quantumRange=excluded.quantumRange,
           lastSyncedAt=datetime('now')
         RETURNING id",
    )
    .bind(wiki_id)
    .bind(rsi_ship_id)
    .bind(wiki_version)
    .bind(&name)
    .bind(&manufacturer)
    .bind(&role)
    .bind(&classification)
    .bind(&focus)
    .bind(size)
    .bind(length)
    .bind(beam)
    .bind(height)
    .bind(max_speed)
    .bind(scm_speed)
    .bind(hull_hp)
    .bind(shield_hp)
    .bind(cargo_scu)
    .bind(crew_min)
    .bind(crew_max)
    .bind(mass)
    .bind(msrp_usd)
    .bind(image_url)
    .bind(em_signature)
    .bind(ir_signature)
    .bind(cross_section)
    .bind(class_name_cig)
    .bind(pitch_rate)
    .bind(yaw_rate)
    .bind(roll_rate)
    .bind(quantum_fuel)
    .bind(quantum_range)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let ship_data_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;

    Ok(Some(ship_data_id))
}

/* ════════════════════  Phase 2b — Hardpoints (slots)  ═════════════════════ */

/// Type de hardpoint SC Wiki → type de slot canonique (réplique HP_TYPE_MAP V1).
pub(crate) fn hp_type_map(t: &str) -> Option<&'static str> {
    match t {
        // Conteneur de tourelle habitée/distante : nœud structurel qui REGROUPE des gimbals
        // (type "Turret") + canons. Conservé comme TURRET pour préserver le regroupement
        // visuel (ex. Hammerhead 6 tourelles × 4 canons). Avant il était sauté → ses canons
        // remontaient en racines indistinctes.
        "TurretBase" | "MannedTurret" => Some("TURRET"),
        "WeaponGun" | "Turret" | "GunTurret" | "BallTurret" | "MiningLaser" => Some("WEAPON"),
        "Shield" => Some("SHIELD"),
        "Cooler" => Some("COOLER"),
        "PowerPlant" => Some("POWER_PLANT"),
        "QuantumDrive" => Some("QUANTUM_DRIVE"),
        "MissileLauncher" | "Missile" => Some("MISSILE"),
        _ => None,
    }
}

/// portName → displayName : retire le préfixe "hardpoint_", remplace "_" par " ", trim.
pub(crate) fn clean_display_name(name: &str) -> String {
    let stripped = if name.to_lowercase().starts_with("hardpoint_") {
        &name[10..]
    } else {
        name
    };
    stripped.replace('_', " ").trim().to_string()
}

/// Réplique syncHardpointsForShip + createHardpointRecursive V1.
/// CLEAR-THEN-RECREATE par vaisseau (supprime les ShipHardpoint source='wiki' puis recrée
/// à partir de l'arbre `hardpoints`). Un nœud non mappable est sauté MAIS ses enfants sont
/// rattachés au grand-parent (parentId conservé). Renvoie le nombre de slots créés.
pub(crate) async fn sync_hardpoints_for_ship(
    app: &AppHandle,
    ship_id: i64,
    hardpoints: &Value,
) -> Result<i64, String> {
    let arr = match hardpoints.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => return Ok(0),
    };

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Clear : on ne supprime que les hardpoints d'origine 'wiki' de ce vaisseau.
    sqlx::query("DELETE FROM ShipHardpoint WHERE shipId = ? AND source = 'wiki'")
        .bind(ship_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Parcours itératif (évite la récursion async). Pile de (nœud, parentId hérité).
    let mut stack: Vec<(&Value, Option<i64>)> = arr.iter().rev().map(|hp| (hp, None)).collect();
    let mut count = 0i64;

    while let Some((hp, parent_id)) = stack.pop() {
        let raw_type = hp.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let raw_sub = hp.get("sub_type").and_then(|x| x.as_str()).unwrap_or("");

        // Installations d'arme FIXES (mitrailleuses de porte / boarding) : type WeaponMount /
        // sous-type WeaponControl, arme soudée non échangeable (class *_Mounted_*). Exclues du
        // loadout comme sur erkul → on saute le nœud ET tout son sous-arbre (pas de réattache).
        if raw_type == "WeaponMount" || raw_sub == "WeaponControl" {
            continue;
        }

        let mapped = hp_type_map(raw_type).or_else(|| hp_type_map(raw_sub));
        let min_size = vi64(hp, "min_size");
        let max_size = vi64(hp, "max_size");
        let children = hp.get("children").and_then(|c| c.as_array());

        match (mapped, min_size, max_size) {
            (Some(slot_type), Some(mn), Some(mx)) => {
                let name = vstr(hp, "name").unwrap_or_default();
                let display = clean_display_name(&name);
                let sub_type = vstr(hp, "sub_type");
                let default_cn = hp.get("item").and_then(|i| vstr(i, "class_name"));

                let row = sqlx::query(
                    "INSERT INTO ShipHardpoint
                       (shipId, portName, displayName, type, subType, minSize, maxSize,
                        defaultComponentClassName, posX, posY, posZ, normalizedX, normalizedY,
                        source, parentId)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'wiki', ?)
                     RETURNING id",
                )
                .bind(ship_id)
                .bind(&name)
                .bind(&display)
                .bind(slot_type)
                .bind(sub_type)
                .bind(mn)
                .bind(mx)
                .bind(default_cn)
                .bind(parent_id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
                let new_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
                count += 1;

                if let Some(kids) = children {
                    for kid in kids.iter().rev() {
                        stack.push((kid, Some(new_id)));
                    }
                }
            }
            _ => {
                // Non mappable : ligne sautée, enfants rattachés au grand-parent.
                if let Some(kids) = children {
                    for kid in kids.iter().rev() {
                        stack.push((kid, parent_id));
                    }
                }
            }
        }
    }

    Ok(count)
}

/* ──────────────────────────────  Radar tactique  ─────────────────────────── */

/// Normalisation relative 0-100 (réplique V1 normalizeAxis) : 0 si l'axe est plat.
pub(crate) fn normalize_axis(v: f64, min: f64, max: f64) -> f64 {
    if max == min {
        0.0
    } else {
        (((v - min) / (max - min)) * 100.0).round()
    }
}

/// Valeurs brutes d'un vaisseau (mapping détourné V1 assumé).
pub(crate) struct RawScores {
    pub(crate) id: i64,
    pub(crate) speed: f64,   // maxSpeed            → radarSpeed
    pub(crate) agility: f64, // scmSpeed/√(mass/1000) → radarAgility
    pub(crate) shield: f64,  // shieldHp            → radarDefense
    pub(crate) cargo: f64,   // cargoScu            → radarFirepower (repurposé)
    pub(crate) crew: f64,    // crewMax             → radarRange    (repurposé)
    pub(crate) hull: f64,    // hullHp              → radarUtility  (repurposé)
}

/// Recalcule les 6 colonnes radar de ShipData (réplique V1 recomputeRadarScores).
/// Normalisation RELATIVE : min/max sur l'ensemble du catalogue → à relancer après
/// chaque sync. Best-effort : l'appelant ignore l'erreur (vaisseaux déjà importés).
pub(crate) async fn recompute_radar_scores(app: &AppHandle) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let rows = sqlx::query(
        "SELECT id, maxSpeed, scmSpeed, mass, shieldHp, hullHp, cargoScu, crewMax FROM ShipData",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Ok(());
    }

    // Valeurs brutes (null → 0 comme V1).
    let mut scored: Vec<RawScores> = Vec::with_capacity(rows.len());
    for r in &rows {
        let id: i64 = r.try_get("id").map_err(|e| e.to_string())?;
        let f = |col: &str| r.try_get::<Option<f64>, _>(col).ok().flatten().unwrap_or(0.0);
        let i = |col: &str| {
            r.try_get::<Option<i64>, _>(col)
                .ok()
                .flatten()
                .map(|v| v as f64)
                .unwrap_or(0.0)
        };
        let scm = f("scmSpeed");
        let mass = f("mass");
        scored.push(RawScores {
            id,
            speed: f("maxSpeed"),
            agility: if mass > 0.0 { scm / (mass / 1000.0).sqrt() } else { 0.0 },
            shield: f("shieldHp"),
            cargo: i("cargoScu"),
            crew: i("crewMax"),
            hull: f("hullHp"),
        });
    }

    // min/max par axe sur l'ensemble (ordre : speed, agility, shield, cargo, crew, hull).
    let mut bounds = [(f64::INFINITY, f64::NEG_INFINITY); 6];
    for s in &scored {
        let axes = [s.speed, s.agility, s.shield, s.cargo, s.crew, s.hull];
        for (i, &val) in axes.iter().enumerate() {
            if val < bounds[i].0 {
                bounds[i].0 = val;
            }
            if val > bounds[i].1 {
                bounds[i].1 = val;
            }
        }
    }

    // UPDATE de chaque ligne dans une seule transaction.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for s in &scored {
        let radar_speed = normalize_axis(s.speed, bounds[0].0, bounds[0].1);
        let radar_agility = normalize_axis(s.agility, bounds[1].0, bounds[1].1);
        let radar_defense = normalize_axis(s.shield, bounds[2].0, bounds[2].1);
        let radar_firepower = normalize_axis(s.cargo, bounds[3].0, bounds[3].1);
        let radar_range = normalize_axis(s.crew, bounds[4].0, bounds[4].1);
        let radar_utility = normalize_axis(s.hull, bounds[5].0, bounds[5].1);
        sqlx::query(
            "UPDATE ShipData SET radarSpeed=?, radarAgility=?, radarDefense=?,
                                 radarFirepower=?, radarRange=?, radarUtility=? WHERE id=?",
        )
        .bind(radar_speed)
        .bind(radar_agility)
        .bind(radar_defense)
        .bind(radar_firepower)
        .bind(radar_range)
        .bind(radar_utility)
        .bind(s.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

/* ──────────────────────────────  baseDps (Phase 2c)  ──────────────────────── */

/// Recalcule ShipData.baseDps pour TOUS les vaisseaux (réplique backfillBaseDps V1).
/// baseDps = somme du `dps` des armes par défaut des hardpoints de type WEAPON, résolues
/// via defaultComponentClassName → Component.className → Component.dps.
///
/// Le tree-walk V1 (sumStockDps) additionne le dps de CHAQUE nœud WEAPON dont le composant
/// a un dps non nul, en visitant tout l'arbre : la somme ne dépend donc pas de la
/// hiérarchie. Un porteur (turret/gimbal) dont le composant par défaut a dps=null (ou ne
/// matche aucun Component) contribue 0 ; ses enfants WEAPON comptent. L'agrégation SQL
/// ci-dessous est l'équivalent exact. Best-effort : COALESCE → 0 pour les vaisseaux sans
/// arme. Nécessite que composants ET hardpoints soient déjà en base.
pub(crate) async fn recompute_base_dps(app: &AppHandle) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    sqlx::query(
        "UPDATE ShipData SET baseDps = (
            SELECT COALESCE(SUM(c.dps), 0)
            FROM ShipHardpoint h
            JOIN Component c ON c.className = h.defaultComponentClassName
            WHERE h.shipId = ShipData.id
              AND h.type = 'WEAPON'
              AND c.dps IS NOT NULL
         )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/* ──────────────────────────────  Commande exposée  ────────────────────────── */

/// Noms (minuscules) des vaisseaux de la flotte (tous comptes confondus).
/// Sert à prioriser l'échantillon Phase 2b sur les vaisseaux réellement possédés.
pub(crate) async fn fleet_ship_names(app: &AppHandle) -> Result<std::collections::HashSet<String>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let rows = sqlx::query("SELECT DISTINCT name FROM Ship")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .map(|s| s.trim().to_lowercase())
        .collect())
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct SampledShip {
    pub(crate) name: String,
    pub(crate) hardpoints: i64,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct WikiSyncResult {
    pub(crate) vehiclesSynced: i64,
    pub(crate) hardpointsSynced: i64,
    pub(crate) errors: i64,
    pub(crate) sample: bool,
    pub(crate) sampledShips: Vec<SampledShip>,
}
