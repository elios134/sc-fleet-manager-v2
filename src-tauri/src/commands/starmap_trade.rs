// Commerce d'un lieu de la carte : terminaux UEX du lieu, meilleurs achats / ventes de
// marchandises (UexCommodityPrice). Regroupement pur et testé ; SQL paramétré.
use serde::Serialize;
use sqlx::Row;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const TOP: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct PriceRow {
    pub id_terminal: i64,
    pub terminal: String,
    pub location: String,
    pub commodity: String,
    pub price_buy: Option<f64>,
    pub price_sell: Option<f64>,
    pub date_modified: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeLine {
    pub commodity: String,
    pub price: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTrade {
    pub terminal: String,
    pub location: String,
    pub last_modified: Option<i64>,
    pub buys: Vec<TradeLine>,
    pub sells: Vec<TradeLine>,
}

/// Regroupe les prix par terminal : 3 achats les moins chers, 3 ventes les mieux payées,
/// date de prix la plus récente. Terminaux sans aucun prix > 0 écartés ; tri par nombre de
/// lignes décroissant puis nom.
pub fn group_trade(rows: Vec<PriceRow>) -> Vec<TerminalTrade> {
    let mut by_term: Vec<(i64, TerminalTrade, usize)> = Vec::new();
    for r in rows {
        let buy = r.price_buy.filter(|p| *p > 0.0);
        let sell = r.price_sell.filter(|p| *p > 0.0);
        if buy.is_none() && sell.is_none() {
            continue;
        }
        let idx = match by_term.iter().position(|(id, _, _)| *id == r.id_terminal) {
            Some(i) => i,
            None => {
                by_term.push((
                    r.id_terminal,
                    TerminalTrade { terminal: r.terminal.clone(), location: r.location.clone(), last_modified: None, buys: vec![], sells: vec![] },
                    0,
                ));
                by_term.len() - 1
            }
        };
        let (_, t, n) = &mut by_term[idx];
        *n += 1;
        t.last_modified = t.last_modified.max(r.date_modified);
        if let Some(p) = buy {
            t.buys.push(TradeLine { commodity: r.commodity.clone(), price: p });
        }
        if let Some(p) = sell {
            t.sells.push(TradeLine { commodity: r.commodity, price: p });
        }
    }
    by_term.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.1.terminal.to_lowercase().cmp(&b.1.terminal.to_lowercase())));
    by_term
        .into_iter()
        .map(|(_, mut t, _)| {
            t.buys.sort_by(|a, b| a.price.total_cmp(&b.price));
            t.buys.truncate(TOP);
            t.sells.sort_by(|a, b| b.price.total_cmp(&a.price));
            t.sells.truncate(TOP);
            t
        })
        .collect()
}

/// Terminaux UEX d'un lieu (noms : corps, ville, station…). Une planète ne récupère pas
/// les terminaux de ses lunes (`moonName IS NULL`).
#[tauri::command]
pub async fn starmap_location_trade(
    db_instances: tauri::State<'_, DbInstances>,
    names: Vec<String>,
) -> Result<Vec<TerminalTrade>, String> {
    let names: Vec<String> = names.into_iter().map(|n| n.trim().to_lowercase()).filter(|n| !n.is_empty()).collect();
    if names.is_empty() {
        return Ok(vec![]);
    }
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("Base de données non chargée : {DB_URL}")),
    };
    let one = "(LOWER(t.cityName) = ? OR LOWER(t.spaceStationName) = ? OR LOWER(t.outpostName) = ?                OR LOWER(t.moonName) = ? OR (LOWER(t.planetName) = ? AND t.moonName IS NULL))";
    let cond = std::iter::repeat(one).take(names.len()).collect::<Vec<_>>().join(" OR ");
    let sql = format!(
        "SELECT t.id AS idTerminal,
                COALESCE(NULLIF(t.displayName, ''), NULLIF(t.name, ''), NULLIF(t.nickname, ''), '—') AS terminal,
                COALESCE(t.cityName, t.spaceStationName, t.outpostName, t.moonName, t.planetName, '') AS location,
                p.commodityName AS commodity, p.priceBuy AS priceBuy, p.priceSell AS priceSell,
                p.dateModified AS dateModified
           FROM UexCommodityPrice p
           JOIN UexTerminal t ON t.id = p.idTerminal
          WHERE {cond}"
    );
    let mut q = sqlx::query(&sql);
    for n in &names {
        for _ in 0..5 {
            q = q.bind(n.clone());
        }
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let rows = rows
        .iter()
        .map(|r| PriceRow {
            id_terminal: r.try_get::<i64, _>("idTerminal").unwrap_or_default(),
            terminal: r.try_get::<String, _>("terminal").unwrap_or_default(),
            location: r.try_get::<String, _>("location").unwrap_or_default(),
            commodity: r.try_get::<Option<String>, _>("commodity").ok().flatten().unwrap_or_default(),
            price_buy: r.try_get::<Option<f64>, _>("priceBuy").ok().flatten(),
            price_sell: r.try_get::<Option<f64>, _>("priceSell").ok().flatten(),
            date_modified: r.try_get::<Option<i64>, _>("dateModified").ok().flatten(),
        })
        .collect();
    Ok(group_trade(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(t: i64, name: &str, c: &str, buy: Option<f64>, sell: Option<f64>, d: i64) -> PriceRow {
        PriceRow { id_terminal: t, terminal: name.into(), location: "Orison".into(), commodity: c.into(), price_buy: buy, price_sell: sell, date_modified: Some(d) }
    }

    #[test]
    fn regroupe_par_terminal_top3() {
        let rows = vec![
            row(1, "TDD Orison", "A", Some(5.0), None, 10),
            row(1, "TDD Orison", "B", Some(2.0), Some(40.0), 30),
            row(1, "TDD Orison", "C", Some(9.0), Some(10.0), 20),
            row(1, "TDD Orison", "D", Some(1.0), Some(25.0), 5),
            row(1, "TDD Orison", "E", None, Some(30.0), 15),
            row(2, "Admin Seraphim", "H", Some(1.1), None, 7),
        ];
        let out = group_trade(rows);
        assert_eq!(out.len(), 2);
        let t = &out[0];
        assert_eq!(t.terminal, "TDD Orison");
        assert_eq!(t.last_modified, Some(30));
        let buys: Vec<&str> = t.buys.iter().map(|l| l.commodity.as_str()).collect();
        assert_eq!(buys, vec!["D", "B", "A"]);
        let sells: Vec<&str> = t.sells.iter().map(|l| l.commodity.as_str()).collect();
        assert_eq!(sells, vec!["B", "E", "D"]);
    }

    #[test]
    fn ignore_prix_nuls() {
        let rows = vec![
            row(1, "T1", "A", Some(0.0), Some(0.0), 1),
            row(1, "T1", "B", None, None, 1),
            row(2, "T2", "C", Some(3.0), None, 1),
        ];
        let out = group_trade(rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].terminal, "T2");
        assert!(out[0].sells.is_empty());
    }

    #[test]
    fn tri_terminaux() {
        let rows = vec![
            row(1, "Zeta", "A", Some(1.0), None, 1),
            row(2, "Beta", "A", Some(1.0), None, 1),
            row(3, "Alpha", "A", Some(1.0), None, 1),
            row(3, "Alpha", "B", Some(2.0), None, 1),
        ];
        let names: Vec<String> = group_trade(rows).into_iter().map(|t| t.terminal).collect();
        assert_eq!(names, vec!["Alpha", "Beta", "Zeta"]);
    }
}
