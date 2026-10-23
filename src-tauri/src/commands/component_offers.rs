// Où acheter les composants d'un loadout : offres UEX (terminal, lieu, prix) par composant.
// Le lieu est rendu en noms (station, ville, lune, planète) : le front les rattache aux corps
// de la carte pour la distance depuis la position et l'itinéraire d'achats.
use serde::Serialize;
use sqlx::Row;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::commands::starmap_trade::terminal_label;
use crate::DB_URL;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentOffer {
    pub class_name: String,
    pub terminal: String,
    pub price: f64,
    pub system: Option<String>,
    pub planet: Option<String>,
    pub moon: Option<String>,
    pub station: Option<String>,
    pub city: Option<String>,
    pub outpost: Option<String>,
}

/// Offres d'un composant, de la moins chère à la plus chère ; un terminal n'apparaît qu'une
/// fois (son prix le plus bas), les prix nuls sont écartés.
pub fn group_offers(rows: Vec<ComponentOffer>) -> Vec<(String, Vec<ComponentOffer>)> {
    let mut out: Vec<(String, Vec<ComponentOffer>)> = Vec::new();
    for o in rows.into_iter().filter(|o| o.price > 0.0) {
        let slot = match out.iter().position(|(c, _)| *c == o.class_name) {
            Some(i) => &mut out[i].1,
            None => {
                out.push((o.class_name.clone(), Vec::new()));
                &mut out.last_mut().expect("poussé juste avant").1
            }
        };
        match slot.iter_mut().find(|x| x.terminal == o.terminal) {
            Some(x) if o.price < x.price => *x = o,
            Some(_) => {}
            None => slot.push(o),
        }
    }
    for (_, offers) in &mut out {
        offers.sort_by(|a, b| a.price.total_cmp(&b.price));
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentOffers {
    pub class_name: String,
    pub offers: Vec<ComponentOffer>,
}

/// Offres d'achat des composants demandés (par `className`), via l'uuid Wiki ou le nom.
#[tauri::command]
pub async fn get_component_offers(
    db_instances: tauri::State<'_, DbInstances>,
    class_names: Vec<String>,
) -> Result<Vec<ComponentOffers>, String> {
    if class_names.is_empty() {
        return Ok(vec![]);
    }
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("Base de données non chargée : {DB_URL}")),
    };
    let marks = vec!["?"; class_names.len()].join(",");
    let sql = format!(
        "SELECT c.className AS className, p.priceBuy AS priceBuy,
                t.nickname AS nickname, t.name AS tname, t.displayName AS displayName,
                t.systemName AS systemName, t.planetName AS planetName, t.moonName AS moonName,
                t.spaceStationName AS station, t.cityName AS city, t.outpostName AS outpost
           FROM Component c
           JOIN ItemPrice p ON p.priceBuy > 0 AND (p.itemUuid = c.wikiId OR p.itemName = c.name)
           JOIN UexTerminal t ON t.id = p.idTerminal
          WHERE c.className IN ({marks})"
    );
    let mut q = sqlx::query(&sql);
    for c in &class_names {
        q = q.bind(c);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let text = |r: &sqlx::sqlite::SqliteRow, col: &str| r.try_get::<Option<String>, _>(col).ok().flatten().filter(|s| !s.trim().is_empty());
    let offers = rows
        .iter()
        .map(|r| ComponentOffer {
            class_name: r.try_get::<String, _>("className").unwrap_or_default(),
            terminal: terminal_label(text(r, "nickname").as_deref(), text(r, "tname").as_deref(), text(r, "displayName").as_deref()),
            price: r.try_get::<Option<f64>, _>("priceBuy").ok().flatten().unwrap_or(0.0),
            system: text(r, "systemName"),
            planet: text(r, "planetName"),
            moon: text(r, "moonName"),
            station: text(r, "station"),
            city: text(r, "city"),
            outpost: text(r, "outpost"),
        })
        .collect();
    Ok(group_offers(offers).into_iter().map(|(class_name, offers)| ComponentOffers { class_name, offers }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer(class: &str, terminal: &str, price: f64) -> ComponentOffer {
        ComponentOffer {
            class_name: class.into(),
            terminal: terminal.into(),
            price,
            system: Some("Stanton".into()),
            planet: None,
            moon: None,
            station: None,
            city: None,
            outpost: None,
        }
    }

    #[test]
    fn offres_triees_par_prix_et_terminal_unique() {
        let out = group_offers(vec![
            offer("shield_a", "Dumper's Depot", 9000.0),
            offer("shield_a", "Centermass", 7000.0),
            offer("cooler_b", "Platinum Bay", 3000.0),
            offer("shield_a", "Dumper's Depot", 8000.0),
            offer("shield_a", "Cousin Crow's", 0.0),
        ]);
        assert_eq!(out.len(), 2);
        let (class, offers) = &out[0];
        assert_eq!(class, "shield_a");
        let seen: Vec<(&str, f64)> = offers.iter().map(|o| (o.terminal.as_str(), o.price)).collect();
        assert_eq!(seen, [("Centermass", 7000.0), ("Dumper's Depot", 8000.0)]);
        assert_eq!(out[1].1.len(), 1);
    }
}
