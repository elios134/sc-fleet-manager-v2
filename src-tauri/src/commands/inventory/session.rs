use crate::commands::inventory::model::Etat;
use crate::commands::inventory::parse::parse_timestamp;

/// Offset de reprise : `journal_pos` si même session et `journal_pos <= taille`, sinon 0
/// (nouvelle session ou log rétréci → on repart du début pour ne pas double-compter).
pub fn reprise(etat: &Etat, journal_id: &str, taille: u64) -> u64 {
    match &etat.journal_id {
        Some(id) if id == journal_id && etat.journal_pos <= taille => etat.journal_pos,
        _ => 0,
    }
}

/// Id de session STABLE pendant une partie : nom du fichier + 1er horodatage LU dans le log
/// (pas la mtime, qui bouge à chaque append). Change quand le jeu réécrit le Game.log.
pub fn journal_id(nom: &str, head: &str) -> String {
    let ts = head.lines().find_map(parse_timestamp).unwrap_or_else(|| "0".into());
    format!("{nom}|{ts}")
}

/// Fenêtre de lecture incrémentale : (octets à lire, nouvel offset). Lit au plus `max`
/// octets à partir de `start` ; l'offset avance EXACTEMENT du nombre d'octets consommés
/// (jamais vers `len` directement, sinon perte de lignes ou double-comptage).
pub fn prochain_lot(start: u64, len: u64, max: u64) -> (u64, u64) {
    let to_read = len.saturating_sub(start).min(max);
    (to_read, start + to_read)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::model::Etat;
    #[test]
    fn reprise_session() {
        let e = Etat { journal_id: Some("Game.log|1791067258.197".into()), journal_pos: 5000, ..Default::default() };
        assert_eq!(reprise(&e, "Game.log|1791067258.197", 8000), 5000);
        assert_eq!(reprise(&e, "Game.log|1791153600.000", 8000), 0);
        assert_eq!(reprise(&e, "Game.log|1791067258.197", 1200), 0);
        assert_eq!(reprise(&Etat::default(), "Game.log|1791067258.197", 8000), 0);
    }
    #[test]
    fn journal_id_stable_sur_le_head() {
        let head = "<2026-06-14T20:00:00.000Z> start\n<2026-06-14T20:00:01.000Z> suite\n";
        assert_eq!(journal_id("Game.log", head), "Game.log|2026-06-14T20:00:00.000Z");
        // Même 1re ligne, head plus long (le jeu a appendu) → id INCHANGÉ.
        let plus_long = format!("{head}<2026-06-14T20:05:00.000Z> encore\n");
        assert_eq!(journal_id("Game.log", &plus_long), "Game.log|2026-06-14T20:00:00.000Z");
        // 1re ligne différente (nouvelle session) → id différent.
        assert_ne!(journal_id("Game.log", "<2026-06-15T09:00:00.000Z> x\n"), journal_id("Game.log", head));
    }
    #[test]
    fn prochain_lot_borne_et_avance() {
        assert_eq!(prochain_lot(500, 8000, 4096), (4096, 4596)); // borné à max, offset += lu
        assert_eq!(prochain_lot(500, 1200, 4096), (700, 1200));  // plus petit que max
        assert_eq!(prochain_lot(8000, 500, 4096), (0, 8000));    // log rétréci → rien
    }
}
