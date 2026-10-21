// Carte depuis les tables Wiki : lignes, icônes de navigation, chiffres romains.

/* ──────────── STARMAP depuis les tables Wiki en base (Phase 1 + 2) ─────────── */
// Alimente StarmapBody depuis WikiLocationPosition + WikiStarmapLocation (peuplées
// par le Cargo, jointes par uuid). AUCUN réseau. Phase 2 : posX/Y/Z = coordonnées
// cartésiennes réelles (mètres, intra-système) → le renderer place les corps en
// log par niveau. La jointure parent↔enfant passe sur l'uuid (colonne wikiUuid) ;
// recordName porte un stem « legacy » qui pilote les couleurs/images côté front.

pub(crate) struct StarmapWikiRow {
    pub(crate) uuid: String,
    pub(crate) record_name: String,
    pub(crate) system: String,
    pub(crate) nav_icon: String,
    pub(crate) name: String,
    pub(crate) name_resolved: bool,
    pub(crate) parent_ref: Option<String>,
    pub(crate) show_orbit: bool,
    pub(crate) orbit_order: Option<i64>,
    pub(crate) pos_x: Option<f64>,
    pub(crate) pos_y: Option<f64>,
    pub(crate) pos_z: Option<f64>,
}

/// type (WikiLocationPosition) → navIcon StarmapBody. None = corps filtré
/// (astéroïdes, anomalies, jump points…) — MÊME set que le datamining pour ne pas
/// noyer la carte. Pas de Lagrange côté Wiki (absent des données).
pub(crate) fn wiki_nav_icon(type_: &str) -> Option<&'static str> {
    match type_ {
        "Star" => Some("Star"),
        "Planet" => Some("Planet"),
        "Moon" => Some("Moon"),
        "LandingZone" => Some("LandingZone"),
        _ if type_.starts_with("Manmade") => Some("Station"),
        _ if type_.starts_with("Outpost") => Some("Outpost"),
        _ => None,
    }
}

/// Dernier token d'une désignation en chiffre romain → entier
/// (ex. "Stanton II" → 2, "Manfred III" → 3). None si non parsable.
pub(crate) fn roman_to_int(s: &str) -> Option<i64> {
    let token = s.split_whitespace().last()?.to_uppercase();
    if token.is_empty() {
        return None;
    }
    let val = |c: char| match c {
        'I' => Some(1),
        'V' => Some(5),
        'X' => Some(10),
        'L' => Some(50),
        'C' => Some(100),
        'D' => Some(500),
        'M' => Some(1000),
        _ => None,
    };
    let digits: Vec<i64> = token.chars().map(val).collect::<Option<Vec<_>>>()?;
    let mut total = 0i64;
    for i in 0..digits.len() {
        if i + 1 < digits.len() && digits[i] < digits[i + 1] {
            total -= digits[i];
        } else {
            total += digits[i];
        }
    }
    Some(total)
}
