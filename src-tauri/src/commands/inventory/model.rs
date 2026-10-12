use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stack { pub qte: i64, pub vu: i64 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lieu { pub code: Option<String>, pub nom: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contenant { pub classe: String, pub scu: i64, pub lieu: Option<i64> }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Etat {
    pub possessions: BTreeMap<String, BTreeMap<String, Stack>>,
    pub sol: BTreeMap<String, BTreeMap<String, Stack>>,
    pub lieux: BTreeMap<String, Lieu>,
    pub contenants: BTreeMap<String, Contenant>,
    pub derniere_trace: Option<i64>,
    pub journal_id: Option<String>,
    pub journal_pos: u64,
}

// jolie()/categorie() ont un miroir TS côté front (aggregate.ts) qui fait l'affichage ;
// on les garde côté Rust, testées, comme référence de parité / usage futur serveur.
#[allow(dead_code)]
const PREFIXES: [&str; 8] = [
    "carryable_tbo_", "carryable_", "item_", "char_armor_", "char_clothing_",
    "weapon_personal_", "fps_consumable_", "mtag_",
];

/// Nom lisible d'une classe de jeu (retire le préfixe, `_`→espace, capitalise).
#[allow(dead_code)]
pub fn jolie(classe: &str) -> String {
    let mut s = classe.to_lowercase();
    for p in PREFIXES {
        if let Some(rest) = s.strip_prefix(p) { s = rest.to_string(); break; }
    }
    s.split(['_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Catégorie d'affichage depuis le préfixe de classe.
#[allow(dead_code)]
pub fn categorie(classe: &str) -> &'static str {
    let c = classe.to_lowercase();
    if c.starts_with("weapon_") {
        "Armes"
    } else if c.starts_with("char_armor_") {
        "Armure"
    } else if c.starts_with("char_clothing_") {
        "Vêtements"
    } else if c.starts_with("fps_consumable") || c.contains("medpen") || c.contains("oxypen") {
        "Consommables"
    } else if c.contains("_shield")
        || c.contains("_qdrive")
        || c.contains("quantum")
        || c.contains("cooler")
        || c.contains("powerplant")
    {
        "Composants"
    } else {
        "Divers"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jolie_retire_prefixe_et_capitalise() {
        assert_eq!(jolie("carryable_tbo_curelife_medpen"), "Curelife Medpen");
        assert_eq!(jolie("weapon_personal_behr_p4ar_01"), "Behr P4ar 01");
    }
    #[test]
    fn categorie_depuis_prefixe() {
        assert_eq!(categorie("weapon_personal_behr_p4ar"), "Armes");
        assert_eq!(categorie("char_armor_core_pembroke"), "Armure");
        assert_eq!(categorie("char_clothing_hat"), "Vêtements");
        assert_eq!(categorie("fps_consumable_medpen"), "Consommables");
        assert_eq!(categorie("carryable_tbo_box"), "Divers");
    }
    #[test]
    fn etat_serde_roundtrip() {
        let mut e = Etat::default();
        e.possessions.entry("MOI".into()).or_default().insert("x".into(), Stack { qte: 2, vu: 5 });
        let s = serde_json::to_string(&e).unwrap();
        let back: Etat = serde_json::from_str(&s).unwrap();
        assert_eq!(back.possessions["MOI"]["x"].qte, 2);
    }
}
