use crate::commands::inventory::model::{Contenant, Etat, Lieu, Stack};
use crate::commands::inventory::parse::{inv_key, InvRef, Mouvement};
use crate::commands::inventory::parse::{parse_inventory_line, parse_location};

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

/// Applique un mouvement SOLDÉ. `cur_loc_nom` = nom de la zone courante : tout Lieu encore
/// anonyme touché par le mouvement en hérite. Un Contenant touché en même temps qu'un Lieu
/// est rattaché à ce Lieu (pour que son contenu soit visible sous ce lieu).
pub fn appliquer(etat: &mut Etat, m: &Mouvement, cur_loc_nom: Option<&str>) {
    if !m.result_ok { return; }
    let Some(classe) = m.src_classe.clone() else { return };
    if m.src_amount <= 0 { return; }
    let vu = epoch(&m.ts);
    etat.derniere_trace = Some(vu);
    if let Some(src) = &m.src { add(etat, &inv_key(src), &classe, -m.src_amount, vu); }
    if let Some(dst) = &m.dst { add(etat, &inv_key(dst), &classe, m.src_amount, vu); }

    let refs = [m.src.as_ref(), m.dst.as_ref()];
    // nomme les lieux anonymes avec la zone courante
    for r in refs.into_iter().flatten() {
        if let InvRef::Lieu(i) = r {
            let e = etat.lieux.entry(i.to_string()).or_insert(Lieu::default());
            if e.nom.is_none() {
                if let Some(n) = cur_loc_nom { e.nom = Some(n.to_string()); }
            }
        }
    }
    // rattache un contenant au lieu présent dans le même mouvement
    let lieu_present = refs.into_iter().flatten().find_map(|r| match r { InvRef::Lieu(i) => Some(*i), _ => None });
    for r in refs.into_iter().flatten() {
        if let InvRef::Contenant(c) = r {
            let e = etat.contenants.entry(c.to_string()).or_insert(Contenant { classe: String::new(), scu: 0, lieu: None });
            if e.lieu.is_none() { e.lieu = lieu_present; }
        }
    }
}

/// Rejoue en ordre toutes les lignes : suit la zone courante (parse_location, reportée entre
/// appels via `etat.cur_loc_nom`) et applique chaque mouvement.
pub fn rejouer_lignes<'a>(etat: &mut Etat, lignes: impl Iterator<Item = &'a str>) {
    let mut cur_nom: Option<String> = etat.cur_loc_nom.clone();
    for ligne in lignes {
        if let Some(z) = parse_location(ligne) { cur_nom = Some(z); }
        if let Some(m) = parse_inventory_line(ligne) {
            appliquer(etat, &m, cur_nom.as_deref());
        }
    }
    etat.cur_loc_nom = cur_nom;
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
        appliquer(&mut e, &mv(None, Some(InvRef::Lieu(555)), "box", 3), Some("New Babbage"));
        assert_eq!(e.possessions["L:555"]["box"].qte, 3);
        assert_eq!(e.lieux["555"].nom.as_deref(), Some("New Babbage"));
        appliquer(&mut e, &mv(Some(InvRef::Lieu(555)), Some(InvRef::Moi), "box", 3), Some("New Babbage"));
        assert!(!e.possessions.contains_key("L:555") || !e.possessions["L:555"].contains_key("box"));
        assert_eq!(e.possessions["MOI"]["box"].qte, 3);
    }
    #[test]
    fn mouvement_non_solde_ignore() {
        let mut e = Etat::default();
        let mut m = mv(None, Some(InvRef::Lieu(1)), "x", 2); m.result_ok = false;
        appliquer(&mut e, &m, None);
        assert!(e.possessions.is_empty());
    }
    #[test]
    fn contenant_rattache_au_lieu_du_mouvement() {
        let mut e = Etat::default();
        // range 3 box depuis l'inventaire du lieu 555 vers le contenant 42 (même station)
        appliquer(&mut e, &mv(Some(InvRef::Lieu(555)), Some(InvRef::Contenant(42)), "box", 3), Some("New Babbage"));
        assert_eq!(e.possessions["C:42"]["box"].qte, 3);
        assert_eq!(e.contenants["42"].lieu, Some(555));
    }
    #[test]
    fn contexte_zone_persiste_entre_appels() {
        let mut e = Etat::default();
        // tick 1 : on arrive à New Babbage (loading screen) + un mouvement
        rejouer_lignes(&mut e, [
            "<2026-06-14T20:00:00.000Z> Loading screen for Stanton_microTech_NewBabbage shown",
            "<2026-06-14T20:01:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[1] Type[MoveItem]. Source Inventory[1:Player:9] Target Inventory[2:Location:555]. Source[Box] amount[1]. Target[NULL] amount[0]. Item[NONE]",
        ].into_iter());
        // tick 2 : AUCUNE ligne de localisation, un nouveau lieu 777 touché → nommé par la zone reportée
        rejouer_lignes(&mut e, [
            "<2026-06-14T20:05:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[2] Type[MoveItem]. Source Inventory[1:Player:9] Target Inventory[3:Location:777]. Source[Box] amount[1]. Target[NULL] amount[0]. Item[NONE]",
        ].into_iter());
        assert_eq!(e.lieux["777"].nom.as_deref(), Some("Stanton_microTech_NewBabbage"));
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
