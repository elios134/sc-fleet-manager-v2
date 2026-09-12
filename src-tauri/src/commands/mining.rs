// Companion minier — couche VALEUR (prix de vente raffiné, live UEX).
//
// La formule de raffinage vit côté front (src/lib/miningRegistry.ts, statique). Ici on
// lit seulement les prix : pour chaque minéral raffinable, le MEILLEUR terminal de vente
// (prix, demande, fraîcheur) depuis UexCommodityPrice × UexTerminal. Lecture seule, aucun
// re-sync (on lit ce que la sync UEX a déjà déposé).

use serde_json::{json, Value};
use sqlx::Row;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

// Minéraux raffinables (doit rester aligné avec MINERALS de miningRegistry.ts). Liste
// FIXE définie ici — jamais d'entrée utilisateur → pas d'injection.
const REFINED: &[&str] = &[
    "Quantanium", "Bexalite", "Taranite", "Borase", "Laranite", "Beryl", "Agricium",
    "Hephaestanite", "Gold", "Diamond", "Titanium", "Tungsten", "Copper", "Corundum",
    "Quartz", "Iron", "Aluminum", "Tin", "Silicon",
];

/// Meilleur point de vente (prix max) par minéral raffiné. Renvoie un tableau JSON
/// { commodityName, terminal, system, priceSell, scuDemand, updatedAt }.
#[tauri::command]
pub async fn get_refinery_sell_prices(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        #[allow(unreachable_patterns)]
        _ => return Err(format!("Base de données non chargée : {DB_URL}")),
    };

    // Placeholders `?` pour la liste fixe (bindés proprement malgré l'absence de risque).
    let holders = std::iter::repeat("?").take(REFINED.len()).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT p.commodityName AS commodityName,
                COALESCE(t.displayName, t.name, '—') AS terminal,
                COALESCE(t.systemName, '') AS system,
                p.priceSell AS priceSell,
                COALESCE(p.scuSellStock, 0) AS scuDemand,
                p.timestampIso AS updatedAt
           FROM UexCommodityPrice p
           LEFT JOIN UexTerminal t ON t.id = p.idTerminal
          WHERE p.priceSell > 0
            AND p.commodityName IN ({holders})
            AND p.priceSell = (
                SELECT MAX(p2.priceSell) FROM UexCommodityPrice p2
                 WHERE p2.commodityName = p.commodityName AND p2.priceSell > 0
            )
          GROUP BY p.commodityName"
    );

    let mut q = sqlx::query(&sql);
    for name in REFINED {
        q = q.bind(*name);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "commodityName": r.try_get::<String, _>("commodityName").unwrap_or_default(),
                "terminal": r.try_get::<String, _>("terminal").unwrap_or_default(),
                "system": r.try_get::<String, _>("system").unwrap_or_default(),
                "priceSell": r.try_get::<f64, _>("priceSell").unwrap_or(0.0),
                "scuDemand": r.try_get::<f64, _>("scuDemand").unwrap_or(0.0),
                "updatedAt": r.try_get::<Option<String>, _>("updatedAt").unwrap_or(None),
            })
        })
        .collect();

    Ok(Value::Array(out))
}
