// Stats de craft (CraftingBlueprint.producedItemStatsJson) calculées depuis le wiki : modificateurs
// de qualité du détail du plan (`aspects`) + valeur de base lue dans la fiche de l'objet produit.
// Remplace l'enrichissement depuis les dumps du Data.p4k. Même format JSON que l'ancien
// (lu par src/lib/craftingStats.ts). Pur : aucun accès réseau ni base.
use serde_json::{json, Value};

/// Affichage d'une stat : unité et transformation reprises de l'ancien enrichissement (libellés
/// anglais du global.ini déjà résolus). `bases` = chemins possibles de la valeur de base dans la
/// fiche objet du wiki ; vide = stat toujours exprimée en pourcentage.
struct StatDef {
    unit: &'static str,
    transform: &'static str,
    scale: f64,
    bases: &'static [&'static str],
}

const fn def(unit: &'static str, transform: &'static str, scale: f64, bases: &'static [&'static str]) -> StatDef {
    StatDef { unit, transform, scale, bases }
}

const PCT: &str = "ConvertFactorToPercentChange";

fn stat_def(gpp: &str) -> StatDef {
    match gpp {
        "gpp_shield_maxhealth" => def("", "none", 1.0, &["shield.max_shield_health", "shield.max_health"]),
        "gpp_health_maxhealth" => def("", "none", 1.0, &["durability.health"]),
        "gpp_armor_temperaturemin" => def("%+.2f ºC", "none", 1.0, &["temperature_resistance.min", "suit_armor.temp_resistance_min", "clothing.temp_resistance_min"]),
        "gpp_armor_temperaturemax" => def("%+.2f ºC", "none", 1.0, &["temperature_resistance.max", "suit_armor.temp_resistance_max", "clothing.temp_resistance_max"]),
        "gpp_armor_radiationdissipation" => def("%.2f mRem/s", "none", 1.0, &["radiation_resistance.radiation_dissipation_rate", "suit_armor.radiation_resistance.radiation_dissipation_rate", "clothing.radiation_resistance.radiation_dissipation_rate"]),
        "gpp_radar_minaimassistdistance" => def("%.2f M", "none", 1.0, &["radar.aim_assist.distance_min_assignment"]),
        "gpp_radar_maxaimassistdistance" => def("%.2f M", "none", 1.0, &["radar.aim_assist.distance_max_assignment"]),
        "gpp_weapon_tractor_force" => def("", "none", 1.0, &["tractor_beam.max_force"]),
        "gpp_weapon_tractor_fullstrengthdist" => def("%.2f M", "none", 1.0, &["tractor_beam.full_strength_distance"]),
        "gpp_weapon_tractor_maxdist" => def("%.2f M", "none", 1.0, &["tractor_beam.max_distance"]),
        "gpp_weapon_tractor_maxvolume" => def("Rating", "Scale", 0.0001, &["tractor_beam.max_volume"]),
        "gpp_itemresource_coolantgeneration" => def("", "none", 1.0, &["resource_network.generation.coolant", "cooler.coolant_segment_generation"]),
        "gpp_itemresource_powergeneration" => def("", "none", 1.0, &["resource_network.generation.power"]),
        "gpp_quantum_speed" => def("%.2f Mm/s", "Scale", 1e-6, &["quantum_drive.standard_jump.drive_speed"]),
        "gpp_weapon_damage" => def("%+.2f %%", "Sequence_DamageEquivalentToPercentChange", 1.0, &[]),
        "gpp_weapon_recoil_kick" => def("%+.2f %%", PCT, 1.0, &[]),
        "gpp_weapon_recoil_handling" => def("%+.2f %%", "ConvertFactorToNegatedPercentChange", 1.0, &[]),
        "gpp_weapon_recoil_smoothness" => def("%+.2f %%", "ConvertFactorToNegatedPercentChange", 1.0, &[]),
        "gpp_weapon_firerate" => def("%.2f RPM", PCT, 1.0, &[]),
        "gpp_quantum_fuelrequirement" => def("%.2f per Km", PCT, 1.0, &[]),
        _ => def("", PCT, 1.0, &[]),
    }
}

/// Nombre au bout d'un chemin pointé (`a.b.c`).
fn number_at(v: &Value, path: &str) -> Option<f64> {
    path.split('.').try_fold(v, |n, k| n.get(k))?.as_f64()
}

fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

/// Segments de qualité ; à défaut, un seul segment depuis quality_range / modifier_range.
fn value_ranges(m: &Value) -> Vec<Value> {
    let segs: Vec<Value> = m
        .get("value_segments")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    Some(json!({
                        "startQuality": num(s, "quality_min")?,
                        "endQuality": num(s, "quality_max")?,
                        "modifierAtStart": num(s, "modifier_at_start")?,
                        "modifierAtEnd": num(s, "modifier_at_end")?,
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    if !segs.is_empty() {
        return segs;
    }
    let (q, r) = (m.get("quality_range"), m.get("modifier_range"));
    let one = (|| {
        Some(json!({
            "startQuality": num(q?, "min")?,
            "endQuality": num(q?, "max")?,
            "modifierAtStart": num(r?, "at_min_quality")?,
            "modifierAtEnd": num(r?, "at_max_quality")?,
        }))
    })();
    one.into_iter().collect()
}

/// Stats du plan (une entrée par emplacement × modificateur). `None` si le plan n'en a aucune :
/// l'appelant laisse alors la colonne telle quelle.
pub(crate) fn build_craft_stats(detail: &Value, item: Option<&Value>) -> Option<Vec<Value>> {
    let aspects = detail.get("aspects")?;
    let aspects = aspects.get("aspects").unwrap_or(aspects).as_array()?;
    let mut out = Vec::new();
    for a in aspects {
        let slot_debug = a.get("key").and_then(Value::as_str);
        let slot_name = a.get("name").and_then(Value::as_str).or(slot_debug).unwrap_or("(slot)");
        for m in a.get("modifiers").and_then(Value::as_array).into_iter().flatten() {
            let Some(key) = m.get("property_key").and_then(Value::as_str) else { continue };
            let gpp = format!("gpp_{key}");
            let d = stat_def(&gpp);
            let base = item.and_then(|it| d.bases.iter().find_map(|p| number_at(it, p)));
            let label = m.get("label").and_then(Value::as_str).unwrap_or(key);
            out.push(json!({
                "slotName": slot_name,
                "slotDebugName": slot_debug,
                "gpp": gpp,
                "statNameLocKey": label,
                "unitLocKey": d.unit,
                "mode": if base.is_some() { "absolute" } else { "percent" },
                "baseValue": base,
                "scale": d.scale,
                "transformType": d.transform,
                "valueRanges": value_ranges(m),
            }));
        }
    }
    (!out.is_empty()).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn modifier(key: &str, label: &str, segs: Value, qr: Value, mr: Value) -> Value {
        json!({ "property_key": key, "label": label, "quality_range": qr, "modifier_range": mr, "value_segments": segs })
    }

    fn surestop() -> (Value, Value) {
        let two = json!([
            { "quality_min": 0, "quality_max": 500, "modifier_at_start": 0.9, "modifier_at_end": 1 },
            { "quality_min": 501, "quality_max": 1000, "modifier_at_start": 1, "modifier_at_end": 1.1 }
        ]);
        let detail = json!({ "aspects": { "aspects": [
            { "key": "SHELL", "name": "Shell", "modifiers": [
                modifier("health_maxhealth", "Integrity", json!([]), json!({"min": 0, "max": 1000}), json!({"at_min_quality": 0.8, "at_max_quality": 1.2}))
            ]},
            { "key": "FIELD ARRAY", "name": "Field Array", "modifiers": [
                modifier("shield_maxhealth", "Max. Shield Strength", two, json!({"min": 0, "max": 500}), json!({"at_min_quality": 0.9, "at_max_quality": 1}))
            ]}
        ]}});
        let item = json!({ "durability": { "health": 1600 }, "shield": { "max_shield_health": 105600 } });
        (detail, item)
    }

    #[test]
    fn surestop_valeurs_absolues_et_segments() {
        let (detail, item) = surestop();
        let s = build_craft_stats(&detail, Some(&item)).expect("stats");
        assert_eq!(s.len(), 2);
        assert_eq!(s[0]["gpp"], "gpp_health_maxhealth");
        assert_eq!(s[0]["slotName"], "Shell");
        assert_eq!(s[0]["slotDebugName"], "SHELL");
        assert_eq!(s[0]["statNameLocKey"], "Integrity");
        assert_eq!(s[0]["mode"], "absolute");
        assert_eq!(s[0]["baseValue"], 1600.0);
        assert_eq!(s[0]["transformType"], "none");
        // Segment unique reconstruit depuis quality_range / modifier_range.
        assert_eq!(s[0]["valueRanges"], json!([{ "startQuality": 0.0, "endQuality": 1000.0, "modifierAtStart": 0.8, "modifierAtEnd": 1.2 }]));
        assert_eq!(s[1]["baseValue"], 105600.0);
        assert_eq!(s[1]["valueRanges"].as_array().unwrap().len(), 2);
        assert_eq!(s[1]["valueRanges"][1]["modifierAtEnd"], 1.1);
    }

    #[test]
    fn base_absente_passe_en_pourcentage() {
        let (detail, _) = surestop();
        let s = build_craft_stats(&detail, None).unwrap();
        assert_eq!(s[0]["mode"], "percent");
        assert_eq!(s[0]["baseValue"], Value::Null);
    }

    #[test]
    fn stat_pourcentage_et_unite_fixe() {
        let detail = json!({ "aspects": [{ "key": "BARREL:", "name": "Barrel", "modifiers": [
            modifier("weapon_recoil_handling", "Recoil Handling", json!([]), json!({"min": 0, "max": 1000}), json!({"at_min_quality": 1.2, "at_max_quality": 0.8}))
        ]}]});
        let s = build_craft_stats(&detail, Some(&json!({}))).unwrap();
        assert_eq!(s[0]["mode"], "percent");
        assert_eq!(s[0]["unitLocKey"], "%+.2f %%");
        assert_eq!(s[0]["transformType"], "ConvertFactorToNegatedPercentChange");
    }

    #[test]
    fn echelle_vitesse_quantique() {
        let detail = json!({ "aspects": [{ "key": "CORE", "name": "Core", "modifiers": [
            modifier("quantum_speed", "Quantum Speed", json!([]), json!({"min": 0, "max": 1000}), json!({"at_min_quality": 0.9, "at_max_quality": 1.1}))
        ]}]});
        let item = json!({ "quantum_drive": { "standard_jump": { "drive_speed": 283000000.0 } } });
        let s = build_craft_stats(&detail, Some(&item)).unwrap();
        assert_eq!(s[0]["mode"], "absolute");
        assert_eq!(s[0]["baseValue"], 283000000.0);
        assert_eq!(s[0]["scale"], 1e-6);
        assert_eq!(s[0]["transformType"], "Scale");
        assert_eq!(s[0]["unitLocKey"], "%.2f Mm/s");
    }

    #[test]
    fn stat_inconnue_reste_en_pourcentage() {
        let detail = json!({ "aspects": [{ "key": "X", "name": "X", "modifiers": [
            modifier("nouvelle_stat", "Nouvelle", json!([]), json!({"min": 0, "max": 1000}), json!({"at_min_quality": 0.9, "at_max_quality": 1.1}))
        ]}]});
        let s = build_craft_stats(&detail, Some(&json!({}))).unwrap();
        assert_eq!(s[0]["gpp"], "gpp_nouvelle_stat");
        assert_eq!(s[0]["mode"], "percent");
        assert_eq!(s[0]["transformType"], "ConvertFactorToPercentChange");
        assert_eq!(s[0]["unitLocKey"], "");
    }

    #[test]
    fn sans_modificateur_rien_a_ecrire() {
        assert!(build_craft_stats(&json!({ "aspects": [{ "key": "A", "modifiers": [] }] }), None).is_none());
        assert!(build_craft_stats(&json!({}), None).is_none());
    }
}
