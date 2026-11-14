// Stations Wiki ajoutées à la carte RSI : la carte RSI ne liste qu'une poignée de stations, le
// Wiki (tables déjà synchronisées par le Cargo) en a ~75 (Lagrange, relais, Gateways…). Les
// coordonnées Wiki sont réelles alors que la carte RSI est stylisée : une station autour d'un
// corps lui est rattachée ; une station en orbite de l'étoile est placée RELATIVEMENT à la
// planète la plus proche (même écart d'angle, même rapport de distance), ce qui met les points
// de Lagrange au bon endroit sur l'orbite RSI de leur planète.
use super::starmap_rsi::StarmapRsiRow;
use sqlx::Row;

#[derive(Debug, Clone)]
pub struct WikiStation {
    pub uuid: String,
    pub name: String,
    pub system: String,
    /// Type du parent Wiki (« Star », « Planet », « Moon »).
    pub parent_type: String,
    pub parent_name: String,
    /// Coordonnées Wiki (mètres, même repère que la géométrie VerseTime en km).
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone)]
pub struct WikiPlanet {
    pub name: String,
    pub system: String,
    pub x: f64,
    pub y: f64,
}

fn key(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

/// Mots d'un nom de station, sans « station » (« Checkmate Station » ≈ « Checkmate »).
fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| !w.is_empty() && w != "station")
        .collect()
}

/// Même station sous deux noms : les mots du plus court sont tous dans le plus long
/// (« Covalex Hub Gundo » ⊂ « Covalex Shipping Hub Gundo »).
fn same_station(a: &str, b: &str) -> bool {
    let (wa, wb) = (words(a), words(b));
    let (short, long) = if wa.len() <= wb.len() { (wa, wb) } else { (wb, wa) };
    !short.is_empty() && short.iter().all(|w| long.contains(w))
}

/// Planète d'un point de Lagrange de Stanton d'après son préfixe (« ARC-L4 … » → ArcCorp).
fn lagrange_planet(name: &str) -> Option<&'static str> {
    let up = name.to_uppercase();
    let code = up.get(..3)?;
    if up.get(3..5)? != "-L" {
        return None;
    }
    match code {
        "ARC" => Some("ArcCorp"),
        "CRU" => Some("Crusader"),
        "HUR" => Some("Hurston"),
        "MIC" => Some("microTech"),
        _ => None,
    }
}

/// Corps qui abrite une station rangée sous l'étoile par le Wiki : son nom figure dans celui
/// de la station, ou un alias connu (Levski est creusée dans l'astéroïde Delamar).
fn host_body<'a>(rsi: &'a [StarmapRsiRow], s: &WikiStation) -> Option<&'a StarmapRsiRow> {
    const ALIASES: [(&str, &str); 1] = [("levski", "delamar")];
    let station = words(&s.name);
    let alias = ALIASES.iter().find(|(st, _)| key(&s.name) == *st).map(|(_, body)| *body);
    rsi.iter().find(|r| {
        r.system == s.system
            && matches!(r.nav_icon.as_str(), "Planet" | "Moon")
            && (alias == Some(key(&r.name).as_str()) || {
                let body = words(&r.name);
                !body.is_empty() && body.iter().all(|w| station.contains(w))
            })
    })
}

/// Lignes « Station » à ajouter aux lignes RSI (doublons de nom et stations sans corps
/// RSI correspondant écartés).
pub fn merge_wiki_stations(rsi: &[StarmapRsiRow], stations: &[WikiStation], planets: &[WikiPlanet]) -> Vec<StarmapRsiRow> {
    let find = |system: &str, name: &str, icons: &[&str]| {
        rsi.iter()
            .find(|r| r.system == system && icons.contains(&r.nav_icon.as_str()) && key(&r.name) == key(name))
    };
    let mut out: Vec<StarmapRsiRow> = Vec::new();
    for s in stations {
        let known = rsi
            .iter()
            .chain(out.iter())
            .any(|r| r.system == s.system && (key(&r.name) == key(&s.name) || (r.nav_icon == "Station" && same_station(&r.name, &s.name))));
        if known {
            continue;
        }
        let host = if s.parent_type == "Star" { host_body(rsi, s) } else { None };
        let (parent_ref, distance, longitude) = if let Some(host) = host {
            (Some(host.wiki_uuid.clone()), None, None)
        } else if s.parent_type == "Star" {
            let star = rsi.iter().find(|r| r.system == s.system && r.nav_icon == "Star");
            // Repère : planète RSI héliocentrique (en orbite de l'étoile, distance connue) ayant
            // son pendant Wiki — celle du préfixe Lagrange, sinon la plus proche en XY Wiki.
            let heliocentric = |p: &WikiPlanet| {
                find(&s.system, &p.name, &["Planet"])
                    .filter(|r| r.distance.is_some() && star.is_some_and(|st| r.parent_ref.as_deref() == Some(st.wiki_uuid.as_str())))
            };
            let named = lagrange_planet(&s.name)
                .and_then(|n| planets.iter().filter(|p| p.system == s.system && key(&p.name) == key(n)).find_map(|p| heliocentric(p).map(|r| (p, r))));
            let near = named.or_else(|| {
                planets
                    .iter()
                    .filter(|p| p.system == s.system)
                    .filter_map(|p| heliocentric(p).map(|r| (p, r)))
                    .min_by(|(a, _), (b, _)| {
                        let da = (a.x - s.x).hypot(a.y - s.y);
                        let db = (b.x - s.x).hypot(b.y - s.y);
                        da.total_cmp(&db)
                    })
            });
            let (Some((wp, rp)), Some(star)) = (near, star) else { continue };
            let (Some(rd), Some(rl)) = (rp.distance, rp.longitude) else { continue };
            let pr = wp.x.hypot(wp.y);
            if pr <= 0.0 {
                continue;
            }
            let ratio = s.x.hypot(s.y) / pr;
            let dlon = s.y.atan2(s.x).to_degrees() - wp.y.atan2(wp.x).to_degrees();
            (Some(star.wiki_uuid.clone()), Some(rd * ratio), Some(rl + dlon))
        } else {
            let Some(parent) = find(&s.system, &s.parent_name, &["Planet", "Moon"]) else { continue };
            (Some(parent.wiki_uuid.clone()), None, None)
        };
        out.push(StarmapRsiRow {
            id: format!("wiki-{}", s.uuid),
            wiki_uuid: format!("wiki-{}", s.uuid),
            record_name: format!("wiki-{}", s.uuid),
            system: s.system.clone(),
            nav_icon: "Station".into(),
            name: s.name.clone(),
            description: None,
            subtype: None,
            appearance: None,
            aff_color: None,
            size: None,
            distance,
            longitude,
            latitude: None,
            pos_x: None,
            pos_y: None,
            pos_z: None,
            habitable: None,
            orbit_order: None,
            parent_ref,
            show_orbit: false,
            real_km: Some((s.x / 1000.0, s.y / 1000.0, s.z / 1000.0)),
        });
    }
    out
}

/// Stations et planètes Wiki en base (vide si les tables Wiki ne sont pas synchronisées).
pub async fn load_wiki_layout(pool: &sqlx::SqlitePool) -> (Vec<WikiStation>, Vec<WikiPlanet>) {
    let stations = sqlx::query(
        "SELECT p.uuid AS uuid, COALESCE(l.name, p.name) AS name, p.systemName AS systemName,
                p.x AS x, p.y AS y, p.z AS z, pp.type AS parentType, COALESCE(pl.name, pp.name) AS parentName
           FROM WikiLocationPosition p
           LEFT JOIN WikiStarmapLocation l ON l.uuid = p.uuid
           LEFT JOIN WikiLocationPosition pp ON pp.uuid = p.parentUuid
           LEFT JOIN WikiStarmapLocation pl ON pl.uuid = p.parentUuid
          WHERE p.hidden = 0 AND p.uuid <> '' AND p.type LIKE 'Manmade%'
            AND p.systemName IN ('stanton','pyro','nyx')",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .iter()
    .filter_map(|r| {
        Some(WikiStation {
            uuid: r.try_get::<String, _>("uuid").ok()?,
            name: r.try_get::<Option<String>, _>("name").ok().flatten().filter(|s| !s.trim().is_empty())?,
            system: r.try_get::<String, _>("systemName").ok()?,
            parent_type: r.try_get::<Option<String>, _>("parentType").ok().flatten().unwrap_or_default(),
            parent_name: r.try_get::<Option<String>, _>("parentName").ok().flatten().unwrap_or_default(),
            x: r.try_get::<Option<f64>, _>("x").ok().flatten()?,
            y: r.try_get::<Option<f64>, _>("y").ok().flatten()?,
            z: r.try_get::<Option<f64>, _>("z").ok().flatten().unwrap_or(0.0),
        })
    })
    .collect();
    let planets = sqlx::query(
        "SELECT COALESCE(l.name, p.name) AS name, p.systemName AS systemName, p.x AS x, p.y AS y
           FROM WikiLocationPosition p
           LEFT JOIN WikiStarmapLocation l ON l.uuid = p.uuid
          WHERE p.type = 'Planet' AND p.systemName IN ('stanton','pyro','nyx')",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .iter()
    .filter_map(|r| {
        Some(WikiPlanet {
            name: r.try_get::<Option<String>, _>("name").ok().flatten()?,
            system: r.try_get::<String, _>("systemName").ok()?,
            x: r.try_get::<Option<f64>, _>("x").ok().flatten()?,
            y: r.try_get::<Option<f64>, _>("y").ok().flatten()?,
        })
    })
    .collect();
    (stations, planets)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rsi(id: &str, icon: &str, name: &str, distance: Option<f64>, longitude: Option<f64>) -> StarmapRsiRow {
        StarmapRsiRow {
            id: id.into(),
            wiki_uuid: id.into(),
            record_name: id.into(),
            system: "stanton".into(),
            nav_icon: icon.into(),
            name: name.into(),
            description: None,
            subtype: None,
            appearance: None,
            aff_color: None,
            size: None,
            distance,
            longitude,
            latitude: None,
            pos_x: None,
            pos_y: None,
            pos_z: None,
            habitable: None,
            orbit_order: None,
            parent_ref: None,
            show_orbit: true,
            real_km: None,
        }
    }
    fn st(uuid: &str, name: &str, parent_type: &str, parent: &str, x: f64, y: f64) -> WikiStation {
        WikiStation { uuid: uuid.into(), name: name.into(), system: "stanton".into(), parent_type: parent_type.into(), parent_name: parent.into(), x, y, z: 0.0 }
    }
    fn rsi_rows() -> Vec<StarmapRsiRow> {
        vec![
            rsi("rsi-1", "Star", "Stanton", None, None),
            rsi("rsi-2", "Planet", "Crusader", Some(1.28), Some(-160.0)),
            rsi("rsi-3", "Planet", "Hurston", Some(0.86), Some(-30.0)),
            rsi("rsi-4", "Moon", "Yela", Some(0.1), Some(10.0)),
            rsi("rsi-5", "Station", "Security Post Kareah", None, None),
            rsi("rsi-6", "Planet", "ArcCorp", Some(1.93), Some(65.0)),
            rsi("rsi-7", "Station", "Covalex Hub Gundo", None, None),
            rsi("rsi-8", "Station", "Checkmate Station", None, None),
        ]
        .into_iter()
        .map(|mut r| {
            if r.nav_icon == "Planet" {
                r.parent_ref = Some("rsi-1".into());
            }
            r
        })
        .collect()
    }
    fn planets() -> Vec<WikiPlanet> {
        vec![
            WikiPlanet { name: "Crusader".into(), system: "stanton".into(), x: -19.0e9, y: 0.0 },
            WikiPlanet { name: "Hurston".into(), system: "stanton".into(), x: 12.0e9, y: 0.0 },
            WikiPlanet { name: "ArcCorp".into(), system: "stanton".into(), x: 18.6e9, y: -22.2e9 },
        ]
    }

    #[test]
    fn station_autour_d_un_corps_rattachee_a_ce_corps() {
        let out = merge_wiki_stations(&rsi_rows(), &[st("g", "Grim HEX", "Moon", "Yela", 0.0, 0.0)], &planets());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].parent_ref.as_deref(), Some("rsi-4"));
        assert_eq!(out[0].nav_icon, "Station");
        assert!(out[0].distance.is_none());
    }

    #[test]
    fn lagrange_placee_sur_l_orbite_rsi_de_la_planete_proche() {
        // L4 de Hurston : même rayon, +60° par rapport à Hurston (angle Wiki 0°).
        let a = 60f64.to_radians();
        let out = merge_wiki_stations(&rsi_rows(), &[st("l4", "HUR-L4 Melodic Fields Station", "Star", "Stanton", 12.0e9 * a.cos(), 12.0e9 * a.sin())], &planets());
        assert_eq!(out[0].parent_ref.as_deref(), Some("rsi-1"));
        assert!((out[0].distance.unwrap() - 0.86).abs() < 1e-9);
        assert!((out[0].longitude.unwrap() - 30.0).abs() < 1e-9);
    }

    #[test]
    fn doublons_et_orphelins_ecartes() {
        let out = merge_wiki_stations(
            &rsi_rows(),
            &[st("k", "Security Post Kareah", "Moon", "Cellin", 0.0, 0.0), st("z", "Nowhere", "Moon", "Inconnue", 0.0, 0.0)],
            &planets(),
        );
        assert!(out.is_empty());
    }

    #[test]
    fn coordonnees_reelles_en_km() {
        let out = merge_wiki_stations(&rsi_rows(), &[st("g", "Grim HEX", "Moon", "Yela", 2_000_000.0, -4_000_000.0)], &planets());
        assert_eq!(out[0].real_km, Some((2000.0, -4000.0, 0.0)));
    }

    #[test]
    fn lagrange_rattachee_a_la_planete_de_son_prefixe() {
        // ARC-L4 au plus près de Hurston en XY Wiki, mais c'est un point de Lagrange d'ArcCorp.
        let out = merge_wiki_stations(&rsi_rows(), &[st("a4", "ARC-L4 Faint Glen Station", "Star", "Stanton", 13.0e9, 1.0e9)], &planets());
        assert!((out[0].distance.unwrap() / 1.93 - (13.0e9f64.hypot(1.0e9) / 18.6e9f64.hypot(-22.2e9))).abs() < 1e-9);
    }

    #[test]
    fn planete_de_reference_heliocentrique_seulement() {
        let mut rows = rsi_rows();
        // « Pyro IV » : planète RSI en orbite d'une autre planète, à ne jamais prendre comme repère.
        let mut moonlike = rsi("rsi-9", "Planet", "Hurston", Some(0.025), Some(55.0));
        moonlike.parent_ref = Some("rsi-2".into());
        rows.retain(|r| r.name != "Hurston");
        rows.push(moonlike);
        let out = merge_wiki_stations(&rows, &[st("s", "Some Station", "Star", "Stanton", 12.5e9, 0.0)], &planets());
        assert!(out[0].distance.unwrap() > 0.5, "rattachée à une planète héliocentrique, pas collée à l'étoile");
    }

    #[test]
    fn doublons_aux_noms_proches_ecartes() {
        let out = merge_wiki_stations(
            &rsi_rows(),
            &[st("c", "Checkmate", "Star", "Stanton", 1.0e9, 0.0), st("g", "Covalex Shipping Hub Gundo", "Moon", "Yela", 0.0, 0.0)],
            &planets(),
        );
        assert!(out.is_empty());
    }

    #[test]
    fn station_d_etoile_rattachee_au_corps_de_son_alias() {
        // Nyx : Levski est rangée sous l'étoile par le Wiki, mais vit dans l'astéroïde Delamar.
        let mut star = rsi("nyx-star", "Star", "Nyx", None, None);
        let mut del = rsi("rsi-2626", "Planet", "Delamar", None, None);
        let mut nyx1 = rsi("nyx-1", "Planet", "Nyx I", Some(0.5), Some(10.0));
        for r in [&mut star, &mut del, &mut nyx1] {
            r.system = "nyx".into();
        }
        del.parent_ref = Some("nyx-star".into());
        nyx1.parent_ref = Some("nyx-star".into());
        let mut lev = st("lev", "Levski", "Star", "Nyx", 1.0e9, 0.0);
        lev.system = "nyx".into();
        let planets = [WikiPlanet { name: "Nyx I".into(), system: "nyx".into(), x: 2.0e9, y: 0.0 }];
        let out = merge_wiki_stations(&[star, del, nyx1], &[lev], &planets);
        assert_eq!(out[0].parent_ref.as_deref(), Some("rsi-2626"));
        assert_eq!(out[0].distance, None);
    }
}
