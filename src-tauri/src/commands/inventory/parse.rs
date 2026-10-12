use regex::Regex;

#[derive(Debug, Clone, PartialEq)]
pub enum InvRef { Moi, Lieu(i64), Contenant(i64) }

#[derive(Debug, Clone)]
pub struct Mouvement {
    pub ts: Option<String>,
    pub type_: String,
    pub result_ok: bool,
    pub src: Option<InvRef>,
    pub dst: Option<InvRef>,
    pub src_classe: Option<String>,
    pub src_amount: i64,
    pub item: Option<String>,
}

pub fn parse_timestamp(line: &str) -> Option<String> {
    Regex::new(r"^<([0-9T:\.\-]+Z)>").ok()?.captures(line)?.get(1).map(|m| m.as_str().to_string())
}

/// `"<n>:Location:<id>"` → Lieu(id) ; `":Container:<id>"` → Contenant(id) ;
/// `INVALID`/`NULL`/vide → None ; tout autre inventaire non nul → Moi (porté par le perso).
pub fn parse_inv_ref(token: &str) -> Option<InvRef> {
    let t = token.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("INVALID") || t.eq_ignore_ascii_case("NULL") {
        return None;
    }
    let parts: Vec<&str> = t.split(':').collect();
    if parts.len() >= 3 {
        let id = parts[2].parse::<i64>().ok();
        match (parts[1], id) {
            ("Location", Some(i)) => return Some(InvRef::Lieu(i)),
            ("Container", Some(i)) => return Some(InvRef::Contenant(i)),
            _ => {}
        }
    }
    Some(InvRef::Moi)
}

fn cap<'a>(re: &Regex, s: &'a str) -> Option<&'a str> {
    re.captures(s).and_then(|c| c.get(1)).map(|m| m.as_str())
}

pub fn parse_inventory_line(line: &str) -> Option<Mouvement> {
    if !line.contains("<InventoryManagementRequest>") {
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

#[cfg(test)]
mod tests {
    use super::*;
    const L: &str = "<2026-06-14T21:00:00.000Z> [Notice] <InventoryManagementRequest> Queued Request[31] Type[MoveItem] for 's' [1]. Source Inventory[100:Location:555] Target Inventory[200:Container:42]. Source[Carryable_TBO_Box_2SCU] amount[3] rank[]. Target[NULL] amount[0] rank[]. Item[NONE]";
    #[test]
    fn parse_ref() {
        assert!(matches!(parse_inv_ref("100:Location:555"), Some(InvRef::Lieu(555))));
        assert!(matches!(parse_inv_ref("200:Container:42"), Some(InvRef::Contenant(42))));
        assert!(parse_inv_ref("INVALID").is_none());
        assert!(matches!(parse_inv_ref("7:Player:9"), Some(InvRef::Moi)));
    }
    #[test]
    fn parse_ligne_complete() {
        let m = parse_inventory_line(L).expect("ligne inventaire");
        assert_eq!(m.type_, "MoveItem");
        assert!(matches!(m.src, Some(InvRef::Lieu(555))));
        assert!(matches!(m.dst, Some(InvRef::Contenant(42))));
        assert_eq!(m.src_classe.as_deref(), Some("carryable_tbo_box_2scu"));
        assert_eq!(m.src_amount, 3);
    }
    #[test]
    fn ignore_ligne_hors_sujet() {
        assert!(parse_inventory_line("<...> [Notice] <Vehicle> blah").is_none());
    }
}
