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

use crate::commands::inventory::parse::{parse_inventory_line, parse_location};

/// Rejoue en ordre toutes les lignes : suit la zone courante (parse_location) et associe le
/// 1er Lieu(id) vu à cette zone (corrélation temporelle), puis applique chaque mouvement.
pub fn rejouer_lignes<'a>(etat: &mut Etat, lignes: impl Iterator<Item = &'a str>) {
    let mut cur_nom: Option<String> = None;
    let mut cur_id: Option<i64> = None;
    for ligne in lignes {
        if let Some(z) = parse_location(ligne) { cur_nom = Some(z); cur_id = None; }
        if let Some(m) = parse_inventory_line(ligne) {
            if cur_id.is_none() {
                for r in [m.src.as_ref(), m.dst.as_ref()].into_iter().flatten() {
                    if let InvRef::Lieu(i) = r { cur_id = Some(*i); break; }
                }
            }
            appliquer(etat, &m, cur_id, cur_nom.as_deref());
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
    #[test]
    fn rejeu_corpus() {
        let corpus = [
            "<2026-06-14T20:00:00.000Z> Loading screen for Stanton_microTech_NewBabbage shown",
            "<2026-06-14T21:00:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[1] Type[MoveItem]. Source Inventory[1:Location:555] Target Inventory[2:Player:9]. Source[Carryable_TBO_Box] amount[2] rank[]. Target[NULL] amount[0]. Item[NONE]",
            "<2026-06-14T21:05:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[2] Type[MoveItem]. Source Inventory[2:Player:9] Target Inventory[1:Location:555]. Source[Carryable_TBO_Box] amount[1] rank[]. Target[NULL] amount[0]. Item[NONE]",
        ];
        let mut e = Etat::default();
        rejouer_lignes(&mut e, corpus.into_iter());
        assert_eq!(e.possessions["MOI"]["carryable_tbo_box"].qte, 1);
        assert_eq!(e.possessions["L:555"]["carryable_tbo_box"].qte, 1);
        assert_eq!(e.lieux["555"].nom.as_deref(), Some("Stanton_microTech_NewBabbage"));
    }
}
