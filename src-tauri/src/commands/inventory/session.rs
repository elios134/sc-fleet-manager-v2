use crate::commands::inventory::model::Etat;

/// Offset de reprise : `journal_pos` si même session et `journal_pos <= taille`, sinon 0
/// (nouvelle session ou log rétréci → on repart du début pour ne pas double-compter).
pub fn reprise(etat: &Etat, journal_id: &str, taille: u64) -> u64 {
    match &etat.journal_id {
        Some(id) if id == journal_id && etat.journal_pos <= taille => etat.journal_pos,
        _ => 0,
    }
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
}
