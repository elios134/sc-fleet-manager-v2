use crate::commands::inventory::model::{Contenant, Etat, Stack};
use crate::commands::inventory::parse::{inv_key, InvRef, Mouvement};
use crate::commands::inventory::parse::{parse_attachment, parse_inventory_line, parse_location};

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
            let e = etat.lieux.entry(i.to_string()).or_default();
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
        if let Some((id, port)) = parse_attachment(ligne) {
            // Le corps ouvre la ré-énumération complète de ce que le perso porte.
            if port.eq_ignore_ascii_case("Body_ItemPort") { etat.portes.clear(); }
            etat.portes.insert(id);
        }
        if let Some(mut m) = parse_inventory_line(ligne) {
            // Conteneur porté (sac, armure) → « sur moi ».
            let porte = |r: &mut Option<InvRef>| {
                if let Some(InvRef::Contenant(c)) = r { if etat.portes.contains(c) { *r = Some(InvRef::Moi); } }
            };
            porte(&mut m.src);
            porte(&mut m.dst);
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
    fn rejeu_journal_reel_actuel() {
        // Extrait réel (10 oct. 2026) : sac porté, terminal de Seraphim, 3 déplacements.
        let corpus = [
            "<2026-10-10T21:02:58.200Z> [Notice] <AttachmentReceived> Player[pilote] Attachment[body_01_noMagicPocket_200000000218, body_01_noMagicPocket, 200000000218] Status[persistent] Port[Body_ItemPort] Elapsed[0.1] [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:02:58.207Z> [Notice] <AttachmentReceived> Player[pilote] Attachment[vgl_combat_heavy_backpack_01_11_01_862178608769, vgl_combat_heavy_backpack_01_11_01, 862178608769] Status[persistent] Port[backpack] Elapsed[0.000014] [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:03:02.691Z> Loading screen for pu : SC_Default closed after 31.06 seconds",
            "<2026-10-10T21:08:49.320Z> [Notice] <RequestLocationInventory> Player[pilote] requested inventory for Location[RR_CRU_LEO] [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:08:51.417Z> [Notice] <Add Inventory Management Move> New Request[12] Player[pilote] Type[Move] SourceInventory[862178608769:Container:0] TargetInventory[204100470772:Location:1752411604] ItemClass[volt_rifle_energy_01_mag] StoredEntity[NULL]",
            "<2026-10-10T21:08:51.418Z> [Notice] <Inventory Mgmt Request Queued> Queued Request[12] Type[Move] for 'pilote' [204100470772] Source Inventory[862178608769:Container:0] Target Inventory[204100470772:Location:1752411604]. Source[volt_rifle_energy_01_mag] amount[20] rank[a]. Target[NULL] amount[0] rank[b]. [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:08:52.084Z> [Notice] <Player Inventory Request Complete> Request[12] for 'pilote' [204100470772] Type[Move] Result[Succeed] Item[0] CanLockQueue[Yes]. [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:08:54.982Z> [Notice] <Inventory Mgmt Request Queued> Queued Request[14] Type[Move] for 'pilote' [204100470772] Source Inventory[862178608769:Container:0] Target Inventory[204100470772:Location:1752411604]. Source[crlf_medgun_vial_01] amount[2] rank[a]. Target[NULL] amount[0] rank[b]. [Team_CoreGameplayFeatures][Inventory]",
            "<2026-10-10T21:09:46.230Z> [Notice] <Inventory Mgmt Request Queued> Queued Request[24] Type[Move] for 'pilote' [204100470772] Source Inventory[204100470772:Location:1752411604] Target Inventory[862178608769:Container:0]. Source[volt_rifle_energy_01_mag] amount[20] rank[a]. Target[NULL] amount[0] rank[b]. [Team_CoreGameplayFeatures][Inventory]",
        ];
        let mut e = Etat::default();
        rejouer_lignes(&mut e, corpus.into_iter());
        // le sac porté compte comme « sur moi »
        assert_eq!(e.possessions["MOI"]["volt_rifle_energy_01_mag"].qte, 20);
        assert!(!e.possessions.contains_key("C:862178608769"));
        // déposé au terminal de la station, nommée par RequestLocationInventory
        assert_eq!(e.possessions["L:1752411604"]["crlf_medgun_vial_01"].qte, 2);
        assert!(!e.possessions["L:1752411604"].contains_key("volt_rifle_energy_01_mag"));
        assert_eq!(e.lieux["1752411604"].nom.as_deref(), Some("RR_CRU_LEO"));
    }
    #[test]
    fn porte_reinitialise_au_respawn() {
        let mut e = Etat::default();
        rejouer_lignes(&mut e, [
            "<2026-10-10T21:00:00.000Z> [Notice] <AttachmentReceived> Player[p] Attachment[body_01_x_1, body_01_x, 1] Status[persistent] Port[Body_ItemPort] Elapsed[0.1]",
            "<2026-10-10T21:00:00.000Z> [Notice] <AttachmentReceived> Player[p] Attachment[sac_a_5, sac_a, 5] Status[persistent] Port[backpack] Elapsed[0.1]",
            "<2026-10-11T21:00:00.000Z> [Notice] <AttachmentReceived> Player[p] Attachment[body_01_x_1, body_01_x, 1] Status[persistent] Port[Body_ItemPort] Elapsed[0.1]",
            "<2026-10-11T21:00:00.000Z> [Notice] <AttachmentReceived> Player[p] Attachment[sac_b_9, sac_b, 9] Status[persistent] Port[backpack] Elapsed[0.1]",
        ].into_iter());
        assert!(e.portes.contains(&9) && !e.portes.contains(&5));
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
