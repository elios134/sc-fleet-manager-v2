// Liste de souhaits (vaisseaux RSI, `RsiShipName.shipId`) + alertes du catalogue CCU : à chaque
// synchro de l'index en ligne, on compare l'état des vaisseaux souhaités avant / après (remis
// en vente, prix warbond, baisse de prix, stock limité). Pas de temps réel : l'index est mis à
// jour par le CCU Updater, quelques fois par semaine.
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use tauri::{AppHandle, State};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sku {
    pub price_cents: i64,
    pub available: bool,
    pub unlimited: bool,
    pub stock: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipState {
    pub available: bool,
    /// Prix le plus bas parmi les SKU en vente (cents USD).
    pub min_price_cents: Option<i64>,
    /// Plusieurs SKU en vente dont un moins cher que le standard (même règle que la chaîne CCU).
    pub warbond: bool,
    /// Un SKU en vente à stock limité.
    pub limited: bool,
    pub stock: Option<i64>,
}

pub fn ship_state(skus: &[Sku]) -> ShipState {
    let on: Vec<&Sku> = skus.iter().filter(|s| s.available && s.price_cents > 0).collect();
    let min = on.iter().map(|s| s.price_cents).min();
    let max = on.iter().map(|s| s.price_cents).max();
    let limited = on.iter().find(|s| !s.unlimited);
    ShipState {
        available: !on.is_empty(),
        min_price_cents: min,
        warbond: on.len() >= 2 && min < max,
        limited: limited.is_some(),
        stock: limited.and_then(|s| s.stock),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Alert {
    BackOnSale { price_cents: Option<i64> },
    Warbond { price_cents: Option<i64> },
    PriceDrop { from_cents: i64, to_cents: i64 },
    Limited { stock: Option<i64> },
}

/// Alertes d'un vaisseau souhaité entre deux états du catalogue (une par changement notable).
pub fn wishlist_alerts(before: &ShipState, after: &ShipState) -> Vec<Alert> {
    let mut out = Vec::new();
    if !after.available {
        return out;
    }
    if !before.available {
        out.push(Alert::BackOnSale { price_cents: after.min_price_cents });
    }
    if after.warbond && !before.warbond {
        out.push(Alert::Warbond { price_cents: after.min_price_cents });
    } else if before.available {
        if let (Some(a), Some(b)) = (before.min_price_cents, after.min_price_cents) {
            if b < a {
                out.push(Alert::PriceDrop { from_cents: a, to_cents: b });
            }
        }
    }
    if after.limited && !before.limited {
        out.push(Alert::Limited { stock: after.stock });
    }
    out
}

fn usd(cents: i64) -> String {
    format!("{}.{:02} $", cents / 100, cents % 100)
}

/// Titre et texte de notification (FR, comme les autres notifications de fond).
pub fn alert_text(ship: &str, a: &Alert) -> (String, String) {
    match a {
        Alert::BackOnSale { price_cents } => (
            format!("{ship} de nouveau en vente"),
            match price_cents {
                Some(p) => format!("{ship} est de nouveau disponible sur le store RSI, à partir de {}.", usd(*p)),
                None => format!("{ship} est de nouveau disponible sur le store RSI."),
            },
        ),
        Alert::Warbond { price_cents } => (
            format!("Prix warbond sur {ship}"),
            match price_cents {
                Some(p) => format!("{ship} est proposé en warbond à {}.", usd(*p)),
                None => format!("{ship} est proposé en warbond."),
            },
        ),
        Alert::PriceDrop { from_cents, to_cents } => (
            format!("{ship} moins cher"),
            format!("{ship} passe de {} à {}.", usd(*from_cents), usd(*to_cents)),
        ),
        Alert::Limited { stock } => (
            format!("{ship} en stock limité"),
            match stock {
                Some(n) => format!("{ship} est en vente limitée ({n} restants)."),
                None => format!("{ship} est en vente limitée."),
            },
        ),
    }
}

macro_rules! pool_of {
    ($db:expr) => {{
        let instances = $db.0.read().await;
        match instances.get(DB_URL) {
            Some(DbPool::Sqlite(p)) => p.clone(),
            #[allow(unreachable_patterns)]
            _ => return Err(format!("Base non chargée : {DB_URL}")),
        }
    }};
}

/// État catalogue des vaisseaux de la liste (shipId → état).
pub async fn wishlist_states(pool: &SqlitePool) -> HashMap<i64, ShipState> {
    let rows = sqlx::query(
        "SELECT w.shipId AS shipId, s.priceCents AS priceCents, s.available AS available,
                s.unlimitedStock AS unlimitedStock, s.availableStock AS availableStock
           FROM WishlistShip w
           LEFT JOIN CcuSku s ON s.shipId = w.shipId",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut skus: HashMap<i64, Vec<Sku>> = HashMap::new();
    for r in &rows {
        let id: i64 = r.try_get("shipId").unwrap_or_default();
        let entry = skus.entry(id).or_default();
        if let Ok(Some(price)) = r.try_get::<Option<i64>, _>("priceCents") {
            entry.push(Sku {
                price_cents: price,
                available: r.try_get::<Option<i64>, _>("available").ok().flatten().unwrap_or(0) != 0,
                unlimited: r.try_get::<Option<i64>, _>("unlimitedStock").ok().flatten().unwrap_or(1) != 0,
                stock: r.try_get::<Option<i64>, _>("availableStock").ok().flatten(),
            });
        }
    }
    skus.into_iter().map(|(id, s)| (id, ship_state(&s))).collect()
}

async fn wishlist_notif_enabled(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, Option<i64>>("SELECT notifWishlist FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .map(|v| v != 0)
        .unwrap_or(true)
}

/// Après une synchro du catalogue : notifie les changements des vaisseaux souhaités.
pub async fn notify_wishlist_changes(app: &AppHandle, pool: &SqlitePool, before: &HashMap<i64, ShipState>) {
    if !wishlist_notif_enabled(pool).await {
        return;
    }
    let after = wishlist_states(pool).await;
    let names: HashMap<i64, String> = sqlx::query("SELECT w.shipId AS id, n.name AS name FROM WishlistShip w JOIN RsiShipName n ON n.shipId = w.shipId")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .iter()
        .filter_map(|r| Some((r.try_get::<i64, _>("id").ok()?, r.try_get::<String, _>("name").ok()?)))
        .collect();
    for (id, state) in &after {
        // Vaisseau ajouté depuis le dernier état connu : pas de comparaison (sinon fausse alerte).
        let Some(prev) = before.get(id).copied() else { continue };
        let name = names.get(id).cloned().unwrap_or_else(|| format!("#{id}"));
        for a in wishlist_alerts(&prev, state) {
            let (title, body) = alert_text(&name, &a);
            super::notifications::notify_background(app, pool, "wishlist", &title, &body).await;
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WishItem {
    pub ship_id: i64,
    pub name: String,
    #[serde(flatten)]
    pub state: ShipState,
}

/// Vaisseaux de la liste de souhaits avec leur état catalogue, par nom.
#[tauri::command]
pub async fn wishlist_list(db_instances: State<'_, DbInstances>) -> Result<Vec<WishItem>, String> {
    let pool = pool_of!(db_instances);
    let states = wishlist_states(&pool).await;
    let rows = sqlx::query(
        "SELECT w.shipId AS id, COALESCE(n.name, '#' || w.shipId) AS name
           FROM WishlistShip w LEFT JOIN RsiShipName n ON n.shipId = w.shipId
          ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let id: i64 = r.try_get("id").unwrap_or_default();
            WishItem { ship_id: id, name: r.try_get("name").unwrap_or_default(), state: states.get(&id).copied().unwrap_or_default() }
        })
        .collect())
}

/// Ajoute / retire un vaisseau de la liste ; renvoie true s'il y est désormais.
#[tauri::command]
pub async fn wishlist_toggle(db_instances: State<'_, DbInstances>, ship_id: i64) -> Result<bool, String> {
    let pool = pool_of!(db_instances);
    let removed = sqlx::query("DELETE FROM WishlistShip WHERE shipId = ?")
        .bind(ship_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();
    if removed > 0 {
        return Ok(false);
    }
    sqlx::query("INSERT INTO WishlistShip (shipId, addedAt) VALUES (?, datetime('now'))")
        .bind(ship_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sku(price: i64, available: bool, unlimited: bool) -> Sku {
        Sku { price_cents: price, available, unlimited, stock: if unlimited { None } else { Some(40) } }
    }

    #[test]
    fn etat_d_un_vaisseau() {
        let s = ship_state(&[sku(30000, true, true), sku(27500, true, true), sku(20000, false, true)]);
        assert!(s.available && s.warbond && !s.limited);
        assert_eq!(s.min_price_cents, Some(27500));
        assert_eq!(ship_state(&[sku(30000, false, true)]), ShipState::default());
        let l = ship_state(&[sku(30000, true, false)]);
        assert!(l.limited && !l.warbond);
        assert_eq!(l.stock, Some(40));
    }

    #[test]
    fn alertes_sur_les_changements_seulement() {
        let off = ShipState::default();
        let on = ShipState { available: true, min_price_cents: Some(30000), ..Default::default() };
        let wb = ShipState { warbond: true, min_price_cents: Some(27500), ..on };
        let cheaper = ShipState { min_price_cents: Some(28000), ..on };
        let lim = ShipState { limited: true, stock: Some(12), ..on };
        assert_eq!(wishlist_alerts(&off, &on), vec![Alert::BackOnSale { price_cents: Some(30000) }]);
        assert_eq!(wishlist_alerts(&on, &on), vec![]);
        assert_eq!(wishlist_alerts(&on, &off), vec![]);
        assert_eq!(wishlist_alerts(&on, &wb), vec![Alert::Warbond { price_cents: Some(27500) }]);
        assert_eq!(wishlist_alerts(&on, &cheaper), vec![Alert::PriceDrop { from_cents: 30000, to_cents: 28000 }]);
        assert_eq!(wishlist_alerts(&on, &lim), vec![Alert::Limited { stock: Some(12) }]);
    }

    #[test]
    fn texte_des_alertes() {
        let (t, b) = alert_text("Polaris", &Alert::PriceDrop { from_cents: 75000, to_cents: 72505 });
        assert_eq!(t, "Polaris moins cher");
        assert_eq!(b, "Polaris passe de 750.00 $ à 725.05 $.");
    }
}
