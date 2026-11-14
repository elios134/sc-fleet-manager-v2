// Réputation par faction (spec docs/specs/2026-11-15-reputation-reprendre.md) — règles pures.
// Le jeu n'écrit ni points ni rang dans le Game.log : les points viennent des missions terminées
// (contrat lu dans le log → `reputationGained` du wiki), le rang se déduit des missions acceptées.
use serde_json::Value;

/// Un rang d'une échelle (`Rank`) : nom, réputation minimale, largeur (None = dernier rang).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RankDef {
    pub name: String,
    pub min: i64,
    pub range: Option<i64>,
}

/// Gain de réputation d'une mission chez (faction, échelle).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RepGain {
    pub faction: String,
    pub scope: String,
    pub amount: i64,
}

/// `reputationGained` du wiki → gains positifs, hors « Affinity » (relation au donneur de mission).
pub(crate) fn parse_gains(json: Option<&str>) -> Vec<RepGain> {
    let Some(v) = json.and_then(|s| serde_json::from_str::<Value>(s).ok()) else {
        return Vec::new();
    };
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|g| {
            let faction = g.get("faction")?.as_str()?.trim().to_string();
            let scope = g.get("scope")?.as_str()?.trim().to_string();
            let amount = g.get("amount")?.as_i64()?;
            (amount > 0 && !faction.is_empty() && scope != "Affinity").then_some(RepGain { faction, scope, amount })
        })
        .collect()
}

/// Position du rang nommé dans l'échelle (casse ignorée).
pub(crate) fn rank_index_of(ladder: &[RankDef], name: &str) -> Option<usize> {
    let n = name.trim();
    ladder.iter().position(|r| r.name.eq_ignore_ascii_case(n))
}

/// Position dans l'échelle à une réputation totale donnée.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Standing {
    pub total: i64,
    pub rank_index: usize,
    pub in_rank: i64,
    /// Réputation à gagner pour passer au rang suivant (None = rang maximal).
    pub to_next: Option<i64>,
}

pub(crate) fn standing_at(ladder: &[RankDef], total: i64) -> Standing {
    let rank_index = ladder.iter().rposition(|r| r.min <= total).unwrap_or(0);
    let min = ladder.get(rank_index).map_or(0, |r| r.min);
    let to_next = ladder.get(rank_index + 1).map(|n| (n.min - total).max(0));
    Standing { total, rank_index, in_rank: total - min, to_next }
}

/// Réputation de départ : rang déclaré (+ réputation dans ce rang) ou rang déduit, sinon 0.
pub(crate) fn base_total(ladder: &[RankDef], rank_index: Option<usize>, rep_in_rank: i64) -> i64 {
    rank_index.and_then(|i| ladder.get(i)).map_or(0, |r| r.min + rep_in_rank.max(0))
}

/// Mission candidate aux conseils (missions du wiki pour la faction).
#[derive(Debug, Clone)]
pub(crate) struct Candidate {
    pub title: String,
    pub amount: i64,
    pub time_mins: Option<i64>,
    pub min_standing: Option<String>,
    pub max_standing: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Advice {
    pub title: String,
    pub amount: i64,
    pub time_mins: i64,
    pub per_hour: i64,
    pub min_rank: Option<String>,
}

/// Missions accessibles au rang `rank_index`, triées par réputation à l'heure (titres dédoublonnés).
pub(crate) fn advise(ladder: &[RankDef], rank_index: usize, candidates: &[Candidate], limit: usize) -> Vec<Advice> {
    let fits = |c: &Candidate| {
        let min_ok = c.min_standing.as_deref().and_then(|n| rank_index_of(ladder, n)).is_none_or(|i| i <= rank_index);
        let max_ok = c.max_standing.as_deref().and_then(|n| rank_index_of(ladder, n)).is_none_or(|i| i >= rank_index);
        min_ok && max_ok
    };
    let mut out: Vec<Advice> = candidates
        .iter()
        .filter(|c| c.amount > 0 && c.time_mins.is_some_and(|t| t > 0) && fits(c))
        .map(|c| {
            let t = c.time_mins.unwrap_or(1);
            Advice { title: c.title.clone(), amount: c.amount, time_mins: t, per_hour: c.amount * 60 / t, min_rank: c.min_standing.clone() }
        })
        .collect();
    out.sort_by(|a, b| b.per_hour.cmp(&a.per_hour).then(b.amount.cmp(&a.amount)).then(a.title.cmp(&b.title)));
    let mut seen = std::collections::HashSet::new();
    out.retain(|a| seen.insert(a.title.to_lowercase()));
    out.truncate(limit);
    out
}

/// Missions restantes avant le rang suivant, à la réputation moyenne des missions conseillées.
pub(crate) fn missions_left(to_next: Option<i64>, advice: &[Advice]) -> Option<i64> {
    let to_next = to_next?;
    if advice.is_empty() {
        return None;
    }
    let avg = advice.iter().map(|a| a.amount).sum::<i64>() / advice.len() as i64;
    (avg > 0).then(|| (to_next + avg - 1) / avg)
}

/// Plans reçus dans les `window_ms` qui suivent la fin d'une mission (même horloge en ms).
pub(crate) fn loot_after(end_ms: i64, blueprints: &[(i64, String)], window_ms: i64) -> Vec<String> {
    blueprints.iter().filter(|(t, _)| *t >= end_ms && *t - end_ms <= window_ms).map(|(_, n)| n.clone()).collect()
}

/// Monogramme d'une faction : initiales des deux premiers mots significatifs (« InterSec Defense » → IS).
pub(crate) fn monogram(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().filter(|w| w.chars().next().is_some_and(|c| c.is_alphanumeric())).collect();
    match words.as_slice() {
        [] => "?".into(),
        [one] => one.chars().filter(|c| c.is_alphanumeric()).take(2).collect::<String>().to_uppercase(),
        [a, b, ..] => {
            // Mot en CamelCase (« InterSec ») : ses deux majuscules priment.
            let caps: String = a.chars().filter(|c| c.is_uppercase()).take(2).collect();
            if caps.chars().count() == 2 {
                caps
            } else {
                format!("{}{}", a.chars().next().unwrap_or('?'), b.chars().next().unwrap_or('?')).to_uppercase()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ladder() -> Vec<RankDef> {
        [("Neutral", 0, Some(800)), ("Jr. Contractor", 800, Some(1400)), ("Contractor", 2200, Some(3600)), ("Sr. Contractor", 5800, Some(9200)), ("Veteran Contractor", 15000, Some(23000)), ("Head Contractor", 38000, Some(57250)), ("Elite Contractor", 95250, None)]
            .into_iter()
            .map(|(n, m, r)| RankDef { name: n.into(), min: m, range: r })
            .collect()
    }

    #[test]
    fn gains_hors_affinite() {
        let g = parse_gains(Some(r#"[{"amount":300,"faction":"InterSec Defense Solutions","scope":"FactionReputation"},{"amount":50,"faction":"Tobin","scope":"Affinity"},{"amount":0,"faction":"X","scope":"Hauling"}]"#));
        assert_eq!(g, vec![RepGain { faction: "InterSec Defense Solutions".into(), scope: "FactionReputation".into(), amount: 300 }]);
        assert!(parse_gains(None).is_empty());
        assert!(parse_gains(Some("pas du json")).is_empty());
    }

    #[test]
    fn position_dans_l_echelle() {
        let l = ladder();
        assert_eq!(standing_at(&l, 15300), Standing { total: 15300, rank_index: 4, in_rank: 300, to_next: Some(22700) });
        assert_eq!(standing_at(&l, 0).rank_index, 0);
        assert_eq!(standing_at(&l, 100000), Standing { total: 100000, rank_index: 6, in_rank: 4750, to_next: None });
    }

    #[test]
    fn depart_declare_deduit_ou_inconnu() {
        let l = ladder();
        assert_eq!(base_total(&l, rank_index_of(&l, "veteran contractor"), 0), 15000);
        assert_eq!(base_total(&l, Some(2), 1500), 3700);
        assert_eq!(base_total(&l, None, 0), 0);
    }

    #[test]
    fn conseils_du_rang_tries_par_heure() {
        let l = ladder();
        let c = |t: &str, a: i64, m: i64, min: Option<&str>, max: Option<&str>| Candidate {
            title: t.into(),
            amount: a,
            time_mins: Some(m),
            min_standing: min.map(Into::into),
            max_standing: max.map(Into::into),
        };
        let cands = vec![
            c("Lente", 300, 60, Some("Contractor"), None),
            c("Rapide", 300, 20, Some("Veteran Contractor"), None),
            c("Trop haut", 300, 10, Some("Elite Contractor"), None),
            c("Trop bas", 300, 10, None, Some("Contractor")),
            c("Rapide", 300, 20, Some("Veteran Contractor"), None),
        ];
        let a = advise(&l, 4, &cands, 8);
        assert_eq!(a.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["Rapide", "Lente"]);
        assert_eq!(a[0].per_hour, 900);
        assert_eq!(missions_left(Some(22700), &a), Some(76));
        assert_eq!(missions_left(None, &a), None);
        assert_eq!(missions_left(Some(10), &[]), None);
    }

    #[test]
    fn plans_rattaches_a_la_fin_de_mission() {
        let bp = vec![(1000, "Avant".to_string()), (5000, "Brassards".to_string()), (40000, "Jambières".to_string()), (99000, "Plus tard".to_string())];
        assert_eq!(loot_after(4000, &bp, 60_000), ["Brassards", "Jambières"]);
    }

    #[test]
    fn monogrammes() {
        assert_eq!(monogram("InterSec Defense Solutions"), "IS");
        assert_eq!(monogram("Bounty Hunters Guild"), "BH");
        assert_eq!(monogram("Covalex"), "CO");
        assert_eq!(monogram("microTech"), "MI");
    }
}
