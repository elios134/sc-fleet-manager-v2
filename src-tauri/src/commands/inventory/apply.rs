use crate::commands::inventory::model::{Etat, Lieu, Stack};
use crate::commands::inventory::parse::{inv_key, InvRef, Mouvement};

fn epoch(ts: &Option<String>) -> i64 {
    // ISO <YYYY-MM-DDTHH:MM:SS…> → epoch s (algorithme civil de Howard Hinnant). Best-effort.
    ts.as_deref().and_then(|s| {
        let b = s.as_bytes();
        if s.len() < 19 { return None; }
        let num = |a: usize, z: usize| std::str::from_utf8(&b[a..z]).ok()?.parse::<i64>().ok();
        let (y, mo, d, h, mi, se) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
        let y2 = if mo <= 2 { y - 1 } else { y };
        let era = (if y2 >= 0 { y2 } else { y2 - 399 }) / 400;
        let yoe = y2 - era * 400;
        let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146097 + doe - 719468;
        Some(days * 86400 + h * 3600 + mi * 60 + se)
    }).unwrap_or(0)
}

fn add(etat: &mut Etat, key: &str, classe: &str, delta: i64, vu: i64) {
    let inv = etat.possessions.entry(key.to_string()).or_default();
    let st = inv.entry(classe.to_string()).or_insert(Stack { qte: 0, vu });
    st.qte += delta;
    st.vu = vu;
    if st.qte <= 0 { inv.remove(classe); }
    if inv.is_empty() { etat.possessions.remove(key); }
}

/// Applique un mouvement SOLDÉ. `cur_loc_*` = lieu courant pour nommer un locId vu pour la 1re fois.
pub fn appliquer(etat: &mut Etat, m: &Mouvement, cur_loc_id: Option<i64>, cur_loc_nom: Option<&str>) {
    if !m.result_ok { return; }
    let Some(classe) = m.src_classe.clone() else { return };
    if m.src_amount <= 0 { return; }
    let vu = epoch(&m.ts);
    etat.derniere_trace = Some(vu);
    if let Some(src) = &m.src { add(etat, &inv_key(src), &classe, -m.src_amount, vu); }
    if let Some(dst) = &m.dst { add(etat, &inv_key(dst), &classe, m.src_amount, vu); }
    for r in [m.src.as_ref(), m.dst.as_ref()].into_iter().flatten() {
        if let InvRef::Lieu(i) = r {
            let e = etat.lieux.entry(i.to_string()).or_insert(Lieu::default());
            if e.nom.is_none() {
                if let (Some(ci), Some(n)) = (cur_loc_id, cur_loc_nom) {
                    if ci == *i { e.nom = Some(n.to_string()); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::model::Etat;
    use crate::commands::inventory::parse::{InvRef, Mouvement};
    fn mv(src: Option<InvRef>, dst: Option<InvRef>, classe: &str, amount: i64) -> Mouvement {
        Mouvement { ts: Some("2026-06-14T21:00:00.000Z".into()), type_: "MoveItem".into(), result_ok: true,
            src, dst, src_classe: Some(classe.into()), src_amount: amount, item: None }
    }
    #[test]
    fn transfere_lieu_vers_moi_et_clampe() {
        let mut e = Etat::default();
        appliquer(&mut e, &mv(None, Some(InvRef::Lieu(555)), "box", 3), Some(555), Some("New Babbage"));
        assert_eq!(e.possessions["L:555"]["box"].qte, 3);
        assert_eq!(e.lieux["555"].nom.as_deref(), Some("New Babbage"));
        appliquer(&mut e, &mv(Some(InvRef::Lieu(555)), Some(InvRef::Moi), "box", 3), Some(555), Some("New Babbage"));
        assert!(!e.possessions.contains_key("L:555") || !e.possessions["L:555"].contains_key("box"));
        assert_eq!(e.possessions["MOI"]["box"].qte, 3);
    }
    #[test]
    fn mouvement_non_solde_ignore() {
        let mut e = Etat::default();
        let mut m = mv(None, Some(InvRef::Lieu(1)), "x", 2); m.result_ok = false;
        appliquer(&mut e, &m, Some(1), None);
        assert!(e.possessions.is_empty());
    }
}
