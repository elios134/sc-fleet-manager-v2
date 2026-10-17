use regex::Regex;

#[derive(Debug, Clone, PartialEq)]
pub enum InvRef { Moi, Lieu(i64), Contenant(i64) }

#[derive(Debug, Clone)]
pub struct Mouvement {
    pub ts: Option<String>,
    // `type_` et `item` sont extraits du log (format documenté) mais pas encore consommés
    // par apply ; conservés pour la lisibilité du mouvement et un usage futur (filtres).
    #[allow(dead_code)]
    pub type_: String,
    pub result_ok: bool,
    pub src: Option<InvRef>,
    pub dst: Option<InvRef>,
    pub src_classe: Option<String>,
    pub src_amount: i64,
    #[allow(dead_code)]
    pub item: Option<String>,
}

pub fn parse_timestamp(line: &str) -> Option<String> {
    Regex::new(r"^<([0-9T:\.\-]+Z)>").ok()?.captures(line)?.get(1).map(|m| m.as_str().to_string())
}

/// `"<joueur>:Location:<id>"` → Lieu(id) ; `"<entité>:Container:0"` → Contenant(entité)
/// (le 3e champ vaut 0 pour les conteneurs : l'identifiant utile est l'entité) ;
/// `INVALID`/`NULL`/vide → None ; tout autre inventaire non nul → Moi (porté par le perso).
pub fn parse_inv_ref(token: &str) -> Option<InvRef> {
    let t = token.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("INVALID") || t.eq_ignore_ascii_case("NULL") {
        return None;
    }
    let parts: Vec<&str> = t.split(':').collect();
    if parts.len() >= 3 {
        match (parts[1], parts[2].parse::<i64>().ok(), parts[0].parse::<i64>().ok()) {
            ("Location", Some(i), _) => return Some(InvRef::Lieu(i)),
            ("Container", _, Some(e)) => return Some(InvRef::Contenant(e)),
            _ => {}
        }
    }
    Some(InvRef::Moi)
}

/// Pièce portée au (re)spawn : `<AttachmentReceived> … Attachment[nom, classe, id] … Port[p]`
/// → (id d'entité, port). Le port `Body_ItemPort` ouvre l'énumération complète.
pub fn parse_attachment(line: &str) -> Option<(i64, String)> {
    if !line.contains("<AttachmentReceived>") {
        return None;
    }
    let at = Regex::new(r"Attachment\[[^\],]*,[^\],]*,\s*(\d+)\]").ok()?;
    let port = Regex::new(r"Port\[([^\]]*)\]").ok()?;
    let id = cap(&at, line)?.parse::<i64>().ok()?;
    Some((id, cap(&port, line)?.to_string()))
}

fn cap<'a>(re: &Regex, s: &'a str) -> Option<&'a str> {
    re.captures(s).and_then(|c| c.get(1)).map(|m| m.as_str())
}

pub fn parse_inventory_line(line: &str) -> Option<Mouvement> {
    // Catégorie selon le build : `InventoryManagementRequest` (ancien) puis
    // `Inventory Mgmt Request Queued` (build 12660092+). Même forme de message. La ligne
    // `Add Inventory Management Move` décrit la MÊME demande : on ne la lit pas (doublon).
    if !(line.contains("<InventoryManagementRequest>") || line.contains("<Inventory Mgmt Request Queued>")) {
        return None;
    }
    let ty = Regex::new(r"Type\[([^\]]+)\]").ok()?;
    let res = Regex::new(r"Result\[([^\]]*)\]").ok()?;
    let si = Regex::new(r"Source Inventory\[([^\]]*)\]").ok()?;
    let ti = Regex::new(r"Target Inventory\[([^\]]*)\]").ok()?;
    let sc = Regex::new(r"Source\[([^\]]*)\]\s*amount\[(-?\d+)\]").ok()?;
    let it = Regex::new(r"Item\[([^\]]*)\]").ok()?;
    let type_ = cap(&ty, line)?.to_string();
    // Pas de Result → considéré soldé (certaines lignes « Queued » n'en portent pas).
    let result_ok = res
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| {
            let r = m.as_str();
            r.is_empty() || r.eq_ignore_ascii_case("Success") || r.eq_ignore_ascii_case("OK")
        })
        .unwrap_or(true);
    let src = cap(&si, line).and_then(parse_inv_ref);
    let dst = cap(&ti, line).and_then(parse_inv_ref);
    let (src_classe, src_amount) = sc
        .captures(line)
        .map(|c| (Some(c[1].to_lowercase()), c[2].parse::<i64>().unwrap_or(0)))
        .unwrap_or((None, 0));
    let item = cap(&it, line)
        .filter(|v| !v.eq_ignore_ascii_case("NONE"))
        .map(|v| v.to_lowercase());
    Some(Mouvement { ts: parse_timestamp(line), type_, result_ok, src, dst, src_classe, src_amount, item })
}

/// Zone courante : `<RequestLocationInventory> … Location[<lieu>]` (terminal d'inventaire
/// d'un lieu, builds actuels) ou `Loading screen for <zone>` (anciens builds). Les écrans
/// génériques (`pu`, `Frontend_*`) ne nomment pas de lieu.
pub fn parse_location(line: &str) -> Option<String> {
    if let Some(c) = Regex::new(r"requested inventory for Location\[([A-Za-z0-9_]+)\]").ok()?.captures(line) {
        return Some(c[1].to_string());
    }
    let z = Regex::new(r"Loading screen for ([A-Za-z0-9_]+)").ok()?.captures(line)?.get(1)?.as_str();
    (!z.eq_ignore_ascii_case("pu") && !z.starts_with("Frontend")).then(|| z.to_string())
}

/// Clé d'inventaire : `Moi`→"MOI", `Lieu(i)`→"L:i", `Contenant(i)`→"C:i".
pub fn inv_key(r: &InvRef) -> String {
    match r {
        InvRef::Moi => "MOI".to_string(),
        InvRef::Lieu(i) => format!("L:{i}"),
        InvRef::Contenant(i) => format!("C:{i}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const L: &str = "<2026-06-14T21:00:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[31] Type[MoveItem] for 's' [1]. Source Inventory[100:Location:555] Target Inventory[200:Container:42]. Source[Carryable_TBO_Box_2SCU] amount[3] rank[]. Target[NULL] amount[0] rank[]. Item[NONE]";
    #[test]
    fn parse_ref() {
        assert!(matches!(parse_inv_ref("100:Location:555"), Some(InvRef::Lieu(555))));
        // Conteneur : l'id utile est l'entité (1er champ), le 3e vaut 0 dans les logs actuels.
        assert!(matches!(parse_inv_ref("862178608769:Container:0"), Some(InvRef::Contenant(862178608769))));
        assert!(parse_inv_ref("INVALID").is_none());
        assert!(matches!(parse_inv_ref("7:Player:9"), Some(InvRef::Moi)));
    }
    #[test]
    fn parse_ligne_complete() {
        let m = parse_inventory_line(L).expect("ligne inventaire");
        assert_eq!(m.type_, "MoveItem");
        assert!(matches!(m.src, Some(InvRef::Lieu(555))));
        assert!(matches!(m.dst, Some(InvRef::Contenant(200)))); // conteneur = entité (1er champ)
        assert_eq!(m.src_classe.as_deref(), Some("carryable_tbo_box_2scu"));
        assert_eq!(m.src_amount, 3);
    }
    // Lignes RÉELLES (build 12913470, oct. 2026 ; nom de joueur anonymisé).
    const QUEUED: &str = "<2026-10-10T21:08:51.418Z> [Notice] <Inventory Mgmt Request Queued> Queued Request[12] Type[Move] for 'pilote' [204100470772] Source Inventory[862178608769:Container:0] Target Inventory[204100470772:Location:1752411604]. Source[volt_rifle_energy_01_mag] amount[20] rank[amrzeceehhhgn]. Target[NULL] amount[0] rank[amrzrildomuun]. [Team_CoreGameplayFeatures][Inventory]";
    #[test]
    fn parse_ligne_queued_actuelle() {
        let m = parse_inventory_line(QUEUED).expect("ligne Queued actuelle");
        assert_eq!(m.type_, "Move");
        assert!(matches!(m.src, Some(InvRef::Contenant(862178608769))));
        assert!(matches!(m.dst, Some(InvRef::Lieu(1752411604))));
        assert_eq!(m.src_classe.as_deref(), Some("volt_rifle_energy_01_mag"));
        assert_eq!(m.src_amount, 20);
        assert!(m.result_ok);
    }
    #[test]
    fn ignore_add_move_doublon() {
        // la même demande apparaît aussi en « Add Inventory Management Move » : ne pas la compter 2 fois
        let l = "<2026-10-10T21:08:51.417Z> [Notice] <Add Inventory Management Move> New Request[12] Player[pilote] Type[Move] SourceInventory[862178608769:Container:0] TargetInventory[204100470772:Location:1752411604] ItemClass[volt_rifle_energy_01_mag] StoredEntity[NULL]";
        assert!(parse_inventory_line(l).is_none());
    }
    #[test]
    fn location_depuis_request_location_inventory() {
        let l = "<2026-10-10T21:08:49.320Z> [Notice] <RequestLocationInventory> Player[pilote] requested inventory for Location[RR_CRU_LEO] [Team_CoreGameplayFeatures][Inventory]";
        assert_eq!(parse_location(l), Some("RR_CRU_LEO".to_string()));
    }
    #[test]
    fn loading_screen_generique_ignore() {
        assert!(parse_location("<2026-10-10T21:03:02.691Z> Loading screen for pu : SC_Default closed after 31.06 seconds").is_none());
        assert!(parse_location("<2026-10-10T20:57:25.449Z> Loading screen for Frontend_Main : SC_Frontend closed").is_none());
    }
    #[test]
    fn attachment_porte() {
        let sac = "<2026-10-10T21:02:58.207Z> [Notice] <AttachmentReceived> Player[pilote] Attachment[vgl_combat_heavy_backpack_01_11_01_862178608769, vgl_combat_heavy_backpack_01_11_01, 862178608769] Status[persistent] Port[backpack] Elapsed[0.000014] [Team_CoreGameplayFeatures][Inventory]";
        assert_eq!(parse_attachment(sac), Some((862178608769, "backpack".to_string())));
        assert!(parse_attachment("<...> [Notice] <Vehicle> blah").is_none());
    }
    #[test]
    fn ignore_ligne_hors_sujet() {
        assert!(parse_inventory_line("<...> [Notice] <Vehicle> blah").is_none());
    }
    #[test]
    fn location_depuis_loading_screen() {
        assert_eq!(parse_location("<...> Loading screen for Stanton_microTech_NewBabbage shown"), Some("Stanton_microTech_NewBabbage".to_string()));
        assert!(parse_location("<...> autre ligne").is_none());
    }
    #[test]
    fn cle_inventaire() {
        assert_eq!(inv_key(&InvRef::Moi), "MOI");
        assert_eq!(inv_key(&InvRef::Lieu(555)), "L:555");
        assert_eq!(inv_key(&InvRef::Contenant(42)), "C:42");
    }
}
