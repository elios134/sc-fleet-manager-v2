// Synchro Wiki des composants (/items) : extraction des stats et upsert.
use super::*;

/* ════════════════════════  Phase 2a — Composants (/items)  ════════════════════ */

// Plafond ÉCHANTILLON (test avant sync complète). None = illimité (toutes les pages).
pub(crate) const COMPONENTS_MAX_PAGES: Option<u32> = None;

/// Valeur flottante via un chemin imbriqué (ex. ["vehicle_weapon","damage","burst"]).
pub(crate) fn nf64(v: &Value, path: &[&str]) -> Option<f64> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_f64()
}

/// Type d'item SC Wiki → slotType canonique (réplique ITEM_TYPE_TO_SLOT V1).
pub(crate) fn item_type_to_slot(t: &str) -> Option<&'static str> {
    match t {
        "WeaponGun" | "WeaponBeam" | "WeaponPlasma" | "WeaponLaser" | "MiningLaser" | "Turret"
        | "WeaponDefensive" => Some("WEAPON"),
        "Shield" => Some("SHIELD"),
        "Cooler" => Some("COOLER"),
        "PowerPlant" => Some("POWER_PLANT"),
        "QuantumDrive" => Some("QUANTUM_DRIVE"),
        "Missile" | "MissileLauncher" => Some("MISSILE"),
        _ => None,
    }
}

/// powerDraw : resource_network.states[].deltas[] où resource == "power" (réplique V1).
pub(crate) fn extract_power_draw(item: &Value) -> Option<f64> {
    let states = item
        .get("resource_network")
        .and_then(|r| r.get("states"))
        .and_then(|s| s.as_array())?;
    for state in states {
        if let Some(deltas) = state.get("deltas").and_then(|d| d.as_array()) {
            for delta in deltas {
                let res = delta.get("resource").and_then(|r| r.as_str()).map(|s| s.to_lowercase());
                if res.as_deref() == Some("power") {
                    if let Some(rate) = delta.get("rate").and_then(|r| r.as_f64()) {
                        return Some(rate);
                    }
                }
            }
        }
    }
    None
}

/// powerDrawMin : usage.power.min sinon resource_network rate × minimum_fraction (V1).
pub(crate) fn extract_power_draw_min(item: &Value) -> Option<f64> {
    if let Some(min) = nf64(item, &["usage", "power", "min"]) {
        return Some(min);
    }
    let states = item
        .get("resource_network")
        .and_then(|r| r.get("states"))
        .and_then(|s| s.as_array())?;
    for state in states {
        if let Some(deltas) = state.get("deltas").and_then(|d| d.as_array()) {
            for delta in deltas {
                let res = delta.get("resource").and_then(|r| r.as_str()).map(|s| s.to_lowercase());
                let rate = delta.get("rate").and_then(|r| r.as_f64());
                let frac = delta.get("minimum_fraction").and_then(|r| r.as_f64());
                if res.as_deref() == Some("power") {
                    if let (Some(rate), Some(frac)) = (rate, frac) {
                        return Some(rate * frac);
                    }
                }
            }
        }
    }
    None
}

/// grade : string ou number → string (la colonne grade est TEXT).
pub(crate) fn coerce_grade(item: &Value) -> Option<String> {
    match item.get("grade") {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// required_tags → JSON string (toujours un tableau, "[]" si absent).
pub(crate) fn required_tags_json(item: &Value) -> String {
    match item.get("required_tags") {
        Some(v) if v.is_array() => serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()),
        _ => "[]".to_string(),
    }
}

/// Mappe un item SC Wiki → Component (+ MissileStats) et upsert par wikiId.
/// Réplique exacte de mapItemToComponent V1. Renvoie true si écrit, false si ignoré
/// (type hors mapping, ou size absent/0).
pub(crate) async fn upsert_component(app: &AppHandle, item: &Value) -> Result<bool, String> {
    let Some(type_raw) = vstr(item, "type") else {
        return Ok(false);
    };
    let Some(slot) = item_type_to_slot(&type_raw) else {
        return Ok(false); // cosmétique, siège, peinture…
    };
    let Some(size) = vi64(item, "size").filter(|s| *s != 0) else {
        return Ok(false); // composant sans dimension
    };

    let name = vstr(item, "name").unwrap_or_default();
    let wiki_id = vstr(item, "uuid");
    let class_name = vstr(item, "class_name");
    let manufacturer = item.get("manufacturer").and_then(|m| vstr(m, "name"));
    let grade = coerce_grade(item);
    let class = vstr(item, "class");
    let sub_type = vstr(item, "sub_type");
    let required_tags = required_tags_json(item);

    let durability_health = nf64(item, &["durability", "health"]);
    let em_max = nf64(item, &["emission", "em_max"]);
    let ir_max = nf64(item, &["emission", "ir"]);
    let power_draw_min = extract_power_draw_min(item);
    let mut power_draw = extract_power_draw(item);

    let mut dps = None;
    let mut shield_hp = None;
    let mut heat_gen = None;
    let mut range = None;
    let mut alpha = None;
    let mut shield_regen_rate = None;
    let mut shield_delay_dmg = None;
    let mut shield_delay_down = None;
    let mut power_output = None;
    let mut w_fire = None;
    let mut w_proj = None;
    let mut w_spread = None;
    let mut w_ammo_cap = None;
    let mut w_ammo_regen = None;
    let mut w_pen = None;
    let mut w_overheat = None;
    let mut shield_regen_time = None;
    let mut qt_speed = None;
    let mut qt_a1 = None;
    let mut qt_a2 = None;
    let mut qt_tt10 = None;
    let mut qt_spool = None;
    let mut qt_cd = None;
    let mut qt_fuel = None;
    let mut qt_eff = None;
    let mut qt_fuel_per_gm = None;

    match slot {
        "WEAPON" => {
            dps = nf64(item, &["vehicle_weapon", "damage", "burst"]);
            alpha = nf64(item, &["vehicle_weapon", "damage", "alpha_total"]);
            range = nf64(item, &["vehicle_weapon", "range"]).or_else(|| nf64(item, &["ammunition", "range"]));
            heat_gen = nf64(item, &["vehicle_weapon", "heat", "per_shot"]);
            w_fire = nf64(item, &["vehicle_weapon", "rpm"]);
            w_proj = nf64(item, &["vehicle_weapon", "ammunition", "speed"]);
            w_spread = nf64(item, &["vehicle_weapon", "spread", "max"]);
            w_ammo_cap = nf64(item, &["vehicle_weapon", "capacitor", "max_ammo_load"]);
            w_ammo_regen = nf64(item, &["vehicle_weapon", "capacitor", "regen_per_second"]);
            w_pen = nf64(item, &["vehicle_weapon", "ammunition", "penetration", "base_distance"]);
            w_overheat = nf64(item, &["distortion", "shutdown_time"]);
        }
        "SHIELD" => {
            shield_hp = nf64(item, &["shield", "max_health"]);
            shield_regen_rate = nf64(item, &["shield", "regen_rate"]);
            shield_delay_dmg = nf64(item, &["shield", "regen_delay", "damage"]);
            shield_delay_down = nf64(item, &["shield", "regen_delay", "downed"]);
            shield_regen_time = nf64(item, &["shield", "regen_time"]);
        }
        "COOLER" => {
            heat_gen = nf64(item, &["resource_network", "generation", "coolant"])
                .or_else(|| nf64(item, &["cooler", "cooling_rate"]))
                .or_else(|| nf64(item, &["cooler", "coolant_segment_generation"]));
        }
        "POWER_PLANT" => {
            power_output = nf64(item, &["resource_network", "generation", "power"])
                .or_else(|| nf64(item, &["power_plant", "power_output"]))
                .or_else(|| nf64(item, &["power_plant", "power_segment_generation"]));
            power_draw = Some(0.0); // les générateurs produisent
        }
        "QUANTUM_DRIVE" => {
            range = nf64(item, &["quantum_drive", "jump_range"]);
            qt_speed = nf64(item, &["quantum_drive", "standard_jump", "drive_speed"]);
            // Taux d'accélération (rampe) + temps de référence 10 Gm, pour le modèle
            // de temps réaliste du planificateur Cargo.
            qt_a1 = nf64(item, &["quantum_drive", "standard_jump", "stage_one_accel_rate"]);
            qt_a2 = nf64(item, &["quantum_drive", "standard_jump", "stage_two_accel_rate"]);
            qt_tt10 = nf64(item, &["quantum_drive", "travel_time_10gm", "seconds"]);
            qt_spool = nf64(item, &["quantum_drive", "standard_jump", "spool_up_time"]);
            qt_cd = nf64(item, &["quantum_drive", "standard_jump", "cooldown_time"]);
            qt_fuel = nf64(item, &["quantum_drive", "fuel_rate"]);
            qt_eff = nf64(item, &["quantum_drive", "fuel_efficiency"]);
            // Conso en SCU/Gm (= affichage Erkul "qt fuel requirement") : directement
            // exploitable pour le coût carburant par leg du GPS trading.
            qt_fuel_per_gm = nf64(item, &["quantum_drive", "fuel_consumption_scu_per_gm"]);
        }
        _ => {} // MISSILE : stats dans MissileStats (ci-dessous)
    }

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
        "INSERT INTO Component
           (wikiId, className, name, manufacturer, type, size, grade, class,
            dps, shieldHp, powerDraw, heatGen, range, alphaDamage,
            shieldRegenRate, shieldDelayDmg, shieldDelayDown, powerOutput,
            durabilityHealth, emMax, irMax, powerDrawMin,
            weaponFireRate, weaponProjectileSpeed, weaponSpreadMax, weaponAmmoCapacity,
            weaponAmmoRegen, weaponPenDistance, weaponOverheatShutdown, shieldRegenTime,
            qtDriveSpeed, qtSpoolTime, qtCooldownTime, qtFuelRate, qtEfficiency,
            qtAccelStageOne, qtAccelStageTwo, qtTravelTime10gm, qtFuelPerGm,
            scWikiType, scWikiSubType, scWikiRequiredTags, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(wikiId) DO UPDATE SET
           className=excluded.className, name=excluded.name, manufacturer=excluded.manufacturer,
           type=excluded.type, size=excluded.size, grade=excluded.grade, class=excluded.class,
           dps=excluded.dps, shieldHp=excluded.shieldHp, powerDraw=excluded.powerDraw,
           heatGen=excluded.heatGen, range=excluded.range, alphaDamage=excluded.alphaDamage,
           shieldRegenRate=excluded.shieldRegenRate, shieldDelayDmg=excluded.shieldDelayDmg,
           shieldDelayDown=excluded.shieldDelayDown, powerOutput=excluded.powerOutput,
           durabilityHealth=excluded.durabilityHealth, emMax=excluded.emMax, irMax=excluded.irMax,
           powerDrawMin=excluded.powerDrawMin, weaponFireRate=excluded.weaponFireRate,
           weaponProjectileSpeed=excluded.weaponProjectileSpeed, weaponSpreadMax=excluded.weaponSpreadMax,
           weaponAmmoCapacity=excluded.weaponAmmoCapacity, weaponAmmoRegen=excluded.weaponAmmoRegen,
           weaponPenDistance=excluded.weaponPenDistance, weaponOverheatShutdown=excluded.weaponOverheatShutdown,
           shieldRegenTime=excluded.shieldRegenTime, qtDriveSpeed=excluded.qtDriveSpeed,
           qtSpoolTime=excluded.qtSpoolTime, qtCooldownTime=excluded.qtCooldownTime,
           qtFuelRate=excluded.qtFuelRate, qtEfficiency=excluded.qtEfficiency,
           qtAccelStageOne=excluded.qtAccelStageOne, qtAccelStageTwo=excluded.qtAccelStageTwo,
           qtTravelTime10gm=excluded.qtTravelTime10gm, qtFuelPerGm=excluded.qtFuelPerGm,
           scWikiType=excluded.scWikiType, scWikiSubType=excluded.scWikiSubType,
           scWikiRequiredTags=excluded.scWikiRequiredTags, lastSyncedAt=datetime('now')
         RETURNING id",
    )
    .bind(wiki_id)
    .bind(class_name)
    .bind(&name)
    .bind(manufacturer)
    .bind(slot)
    .bind(size)
    .bind(grade)
    .bind(class)
    .bind(dps)
    .bind(shield_hp)
    .bind(power_draw)
    .bind(heat_gen)
    .bind(range)
    .bind(alpha)
    .bind(shield_regen_rate)
    .bind(shield_delay_dmg)
    .bind(shield_delay_down)
    .bind(power_output)
    .bind(durability_health)
    .bind(em_max)
    .bind(ir_max)
    .bind(power_draw_min)
    .bind(w_fire)
    .bind(w_proj)
    .bind(w_spread)
    .bind(w_ammo_cap)
    .bind(w_ammo_regen)
    .bind(w_pen)
    .bind(w_overheat)
    .bind(shield_regen_time)
    .bind(qt_speed)
    .bind(qt_spool)
    .bind(qt_cd)
    .bind(qt_fuel)
    .bind(qt_eff)
    .bind(qt_a1)
    .bind(qt_a2)
    .bind(qt_tt10)
    .bind(qt_fuel_per_gm)
    .bind(&type_raw)
    .bind(sub_type)
    .bind(&required_tags)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let component_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;

    // MissileStats pour les missiles (réplique upsertMissileStats V1).
    if slot == "MISSILE" {
        if let Some(m) = item.get("missile") {
            sqlx::query(
                "INSERT INTO MissileStats
                   (componentId, damage, signalType, armTime, lockTime, igniteTime,
                    lockAngle, lockRangeMin, lockRangeMax, speed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(componentId) DO UPDATE SET
                   damage=excluded.damage, signalType=excluded.signalType, armTime=excluded.armTime,
                   lockTime=excluded.lockTime, igniteTime=excluded.igniteTime, lockAngle=excluded.lockAngle,
                   lockRangeMin=excluded.lockRangeMin, lockRangeMax=excluded.lockRangeMax, speed=excluded.speed",
            )
            .bind(component_id)
            .bind(nf64(m, &["damage_total"]))
            .bind(vstr(m, "signal_type"))
            .bind(nf64(m, &["delays", "arm_time"]))
            .bind(nf64(m, &["lock_time"]))
            .bind(nf64(m, &["delays", "ignite_time"]))
            .bind(nf64(m, &["lock_angle"]))
            .bind(nf64(m, &["lock_range_min"]))
            .bind(nf64(m, &["lock_range_max"]))
            .bind(nf64(m, &["speed"]))
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(true)
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct ComponentSyncResult {
    pub(crate) componentsSynced: i64,
    pub(crate) errors: i64,
    pub(crate) sample: bool,
}
