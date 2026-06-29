// Modèle de temps de trajet quantique (rampe accel a1→a2 → vmax → décel symétrique).
// Fonctions PURES (aucune dépendance DB/réseau) — portage de routePlanner.js, extraites
// de cargo_routes.rs pour être testables isolément. Critique pour le calcul de profit
// des routes (le temps de trajet pondère le profit/heure).

/// Distance parcourue pendant la phase de rampe à l'instant t (accel a1→a2 linéaire).
pub fn ramp_distance(t: f64, a1: f64, a2: f64, t_ramp: f64) -> f64 {
    let delta = a2 - a1;
    0.5 * a1 * t * t + delta * t * t * t / (6.0 * t_ramp)
}

/// Dichotomie : t dans [0, t_ramp] tel que ramp_distance(t) ≈ target.
pub fn solve_ramp_time(target: f64, a1: f64, a2: f64, t_ramp: f64) -> Option<f64> {
    if target < 0.0 || t_ramp <= 0.0 {
        return None;
    }
    if target > ramp_distance(t_ramp, a1, a2, t_ramp) {
        return None;
    }
    let (mut lo, mut hi) = (0.0f64, t_ramp);
    for _ in 0..60 {
        let mid = (lo + hi) / 2.0;
        if ramp_distance(mid, a1, a2, t_ramp) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some((lo + hi) / 2.0)
}

/// Temps de trajet quantique (s) pour une distance (m) avec rampe accel — portage exact
/// de estimateTravelTime : montée a1→a2 jusqu'à vmax, croisière, descente symétrique.
pub fn ramp_travel_seconds(vmax: f64, a1: f64, a2: f64, dist_m: f64) -> Option<f64> {
    if dist_m <= 0.0 {
        return Some(0.0);
    }
    if vmax <= 0.0 || a1 <= 0.0 || a2 <= 0.0 {
        return None;
    }
    let sum_a = a1 + a2;
    let t_ramp = (2.0 * vmax) / sum_a;
    let d_ramp = (2.0 * vmax * vmax / (sum_a * sum_a)) * ((a2 - a1) / 3.0 + a1);
    let d_two = 2.0 * d_ramp;
    if dist_m >= d_two {
        return Some(2.0 * t_ramp + (dist_m - d_two) / vmax);
    }
    solve_ramp_time(dist_m / 2.0, a1, a2, t_ramp).map(|t_half| 2.0 * t_half)
}

/// Temps de trajet quantique avec replis : rampe (a1/a2) → vmax-only → tt10-linéaire.
pub fn qt_travel_seconds(
    dist_m: f64,
    vmax: Option<f64>,
    a1: Option<f64>,
    a2: Option<f64>,
    tt10: Option<f64>,
) -> Option<f64> {
    if let (Some(v), Some(x), Some(y)) = (vmax, a1, a2) {
        if v > 0.0 && x > 0.0 && y > 0.0 {
            if let Some(s) = ramp_travel_seconds(v, x, y, dist_m) {
                return Some(s);
            }
        }
    }
    if let Some(v) = vmax {
        if v > 0.0 {
            return Some(dist_m / v); // repli vmax-only
        }
    }
    if let Some(tt) = tt10 {
        if tt > 0.0 {
            return Some((dist_m / 1.0e9 / 10.0) * tt); // repli tt10-linéaire
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn ramp_distance_constant_accel() {
        // a1==a2 → delta=0 → 0.5*a*t²
        assert!(close(ramp_distance(2.0, 3.0, 3.0, 10.0), 6.0));
        assert!(close(ramp_distance(0.0, 3.0, 5.0, 10.0), 0.0));
    }

    #[test]
    fn solve_ramp_time_inverts_distance() {
        let t = solve_ramp_time(6.0, 3.0, 3.0, 10.0).unwrap();
        assert!((t - 2.0).abs() < 1e-3);
        assert_eq!(solve_ramp_time(-1.0, 3.0, 3.0, 10.0), None);
        assert_eq!(solve_ramp_time(5.0, 3.0, 3.0, 0.0), None); // t_ramp<=0
        // cible au-delà du max atteignable sur [0,t_ramp]
        assert_eq!(solve_ramp_time(1e9, 3.0, 3.0, 10.0), None);
    }

    #[test]
    fn ramp_travel_seconds_cruise_phase() {
        // vmax=10, a=5 : t_ramp=2, d_ramp=10, d_two=20 ; dist=120 → 4 + 100/10 = 14
        assert!(close(ramp_travel_seconds(10.0, 5.0, 5.0, 120.0).unwrap(), 14.0));
        assert_eq!(ramp_travel_seconds(10.0, 5.0, 5.0, 0.0), Some(0.0));
        assert_eq!(ramp_travel_seconds(0.0, 5.0, 5.0, 100.0), None); // vmax<=0
        assert_eq!(ramp_travel_seconds(10.0, 0.0, 5.0, 100.0), None); // a1<=0
    }

    #[test]
    fn qt_travel_seconds_fallbacks() {
        // rampe complète
        assert!(close(qt_travel_seconds(120.0, Some(10.0), Some(5.0), Some(5.0), None).unwrap(), 14.0));
        // repli vmax-only : dist/v
        assert!(close(qt_travel_seconds(1000.0, Some(10.0), None, None, None).unwrap(), 100.0));
        // repli tt10-linéaire : (dist/1e9/10)*tt
        assert!(close(qt_travel_seconds(1.0e10, None, None, None, Some(20.0)).unwrap(), 20.0));
        // rien d'exploitable → None
        assert_eq!(qt_travel_seconds(5.0, None, None, None, None), None);
    }
}
