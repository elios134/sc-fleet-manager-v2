// Helpers de dates (sans dépendance) et mise en forme des lignes Ship : expirations d'assurance.
use super::*;

/* ───────────────────────  Helpers date (sans dépendance)  ─────────────────── */

/// Numéro de jour depuis 1970-01-01 (algorithme days_from_civil de H. Hinnant).
/// `m` ∈ [1,12], `d` ∈ [1,31]. Valeur monotone → diffs = nombres de jours.
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub(crate) fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub(crate) fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Nom de mois anglais (complet ou abrégé) → numéro [1,12].
pub(crate) fn month_to_num(s: &str) -> Option<i64> {
    match s.to_lowercase().get(..3)? {
        "jan" => Some(1),
        "feb" => Some(2),
        "mar" => Some(3),
        "apr" => Some(4),
        "may" => Some(5),
        "jun" => Some(6),
        "jul" => Some(7),
        "aug" => Some(8),
        "sep" => Some(9),
        "oct" => Some(10),
        "nov" => Some(11),
        "dec" => Some(12),
        _ => None,
    }
}

/// Parse une date « May 26, 2026 » (mois anglais ; format RSI /en/) → (année, mois, jour).
pub(crate) fn parse_created_date(raw: &str) -> Option<(i64, i64, i64)> {
    let cleaned = raw.replace(',', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let month = month_to_num(parts[0])?;
    let day = parts[1].parse::<i64>().ok()?;
    let year = parts[2].parse::<i64>().ok()?;
    if !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

/// Jour courant (UTC) en nombre de jours depuis 1970-01-01.
pub(crate) fn today_days() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    secs / 86_400
}

/// Réplique V1 `computeNextExpiry` : expiry = createdDate + insuranceMonths mois ;
/// ignore LTI (months null) et déjà-expirés ; renvoie le plus proche. `pledges` =
/// (createdDate brut, insuranceMonths, nom du 1ᵉʳ vaisseau ou nom du pledge).
pub(crate) fn compute_next_expiry(
    pledges: &[(Option<String>, Option<i64>, String)],
) -> Option<NextExpiry> {
    let now = today_days();
    let mut best: Option<NextExpiry> = None;

    for (created, months, ship_name) in pledges {
        let (Some(created), Some(months)) = (created, months) else {
            continue;
        };
        let Some((y, m, d)) = parse_created_date(created) else {
            continue;
        };
        // Ajout de `months` mois (jour conservé, borné à la longueur du mois cible).
        let total = (m - 1) + months;
        let ey = y + total.div_euclid(12);
        let em = total.rem_euclid(12) + 1;
        let ed = d.min(days_in_month(ey, em));

        let days_remaining = days_from_civil(ey, em, ed) - now;
        if days_remaining <= 0 {
            continue;
        }
        if best.as_ref().is_none_or(|b| days_remaining < b.daysRemaining) {
            best = Some(NextExpiry {
                shipName: ship_name.clone(),
                daysRemaining: days_remaining,
            });
        }
    }
    best
}

pub(crate) fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut obj = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let value = if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            v.map(|n| json!(n)).unwrap_or(Value::Null)
        } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            v.map(|n| json!(n)).unwrap_or(Value::Null)
        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            v.map(Value::String).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        obj.insert(name, value);
    }
    Value::Object(obj)
}
