// Types du GPS trading (graphe navigable pas à pas).
use super::*;

/* ════════════ GPS trading — navigation pas-à-pas (LOT 1, 100 % lecture) ═══════════ */

/// Denrée achetable à un carrefour (vue GPS). `out_of_stock` = rupture (stock courant 0).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsBuyItem {
    pub(crate) commodity: String,
    pub(crate) buy_price: f64,
    pub(crate) stock: Option<i64>,
    pub(crate) status_buy: Option<i64>,
    pub(crate) out_of_stock: bool,
}

/// Un leg du graphe GPS = CargoRoute (compat modale détails + soute) + clés de carrefour
/// (pour chaîner front en mémoire) + affluence estimée.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsLeg {
    #[serde(flatten)]
    pub(crate) route: CargoRoute,
    pub(crate) from_key: String,
    pub(crate) to_key: String,
    pub(crate) affluence: String,
}

/// Position d'un lieu (carte du LOT 2 — déjà présent dans Market, exposé dès maintenant).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsPos {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) z: f64,
    pub(crate) system: Option<String>,
}

/// Référence de lieu pour le sélecteur de départ.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsLocation {
    pub(crate) key: String,
    pub(crate) name: String,
    pub(crate) system: Option<String>,
}

/// Graphe de trading complet d'un vaisseau, chargé en UN appel : la navigation pas-à-pas
/// (carrefour → reventes → confirmation → nouveau carrefour) + le breadcrumb se font
/// ensuite 100 % côté front, sans recalcul backend par étape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeGraph {
    pub(crate) ship_name: String,
    pub(crate) cargo_scu: Option<i64>,
    pub(crate) qt_resolved: bool,
    /// Autonomie quantique max du vaisseau (Gm). None si non synchronisée.
    pub(crate) quantum_range_gm: Option<f64>,
    /// Capacité du réservoir de carburant quantique (SCU). None si non synchronisée.
    pub(crate) quantum_fuel_scu: Option<f64>,
    pub(crate) legs_from: std::collections::HashMap<String, Vec<GpsLeg>>,
    pub(crate) buyable_at: std::collections::HashMap<String, Vec<GpsBuyItem>>,
    pub(crate) positions: std::collections::HashMap<String, GpsPos>,
    pub(crate) locations: Vec<GpsLocation>,
}
