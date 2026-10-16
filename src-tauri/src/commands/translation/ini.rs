// global.ini : normalisation pour comparer local/distant, garde-fou de plausibilité avant
// toute écriture, encodage UTF-8 + BOM exigé par SC, aperçu « 3 clés témoin ».

const BOM: char = '\u{FEFF}';

/// Clés repères affichées en aperçu : traduites dans les packs FR connus (mission, siège,
/// version mobiGlas). Les noms de vaisseaux/ressources restent en anglais → inutiles ici.
pub const TEMOINS: [&str; 3] = ["delivery_pickuptitle_long", "ui_CIExit", "mobiGlas_ui_greeble_1,P"];

/// Paire `clé=valeur` d'une ligne (clé = avant le 1er `=`, peut contenir des virgules).
fn kv(line: &str) -> Option<(&str, &str)> {
    let t = line.trim_start_matches(BOM).trim();
    if t.starts_with('#') || t.starts_with(';') {
        return None;
    }
    let (k, v) = t.split_once('=')?;
    let k = k.trim();
    (!k.is_empty()).then_some((k, v.trim()))
}

/// Retire BOM, uniformise les fins de ligne, trim.
pub fn normalize(s: &str) -> String {
    s.trim_start_matches(BOM).replace("\r\n", "\n").trim().to_string()
}

/// Même contenu une fois normalisé (« à jour ? »).
pub fn same_content(a: &str, b: &str) -> bool {
    normalize(a) == normalize(b)
}

/// Garde-fou : non vide, pas du HTML (page d'erreur / login), au moins une ligne `clé=valeur`.
pub fn is_plausible(s: &str) -> bool {
    let t = s.trim_start_matches(BOM).trim_start();
    !t.is_empty() && !t.starts_with('<') && t.lines().any(|l| kv(l).is_some())
}

fn kv_count(s: &str) -> usize {
    s.lines().filter(|l| kv(l).is_some()).count()
}

/// Garde-fou des mises à jour (souvent sans le joueur) : plausible ET au moins la moitié
/// des lignes `clé=valeur` du fichier local (refuse un fichier tronqué / le mauvais fichier).
pub fn plausible_update(local: &str, remote: &str) -> bool {
    is_plausible(remote) && kv_count(remote) * 2 >= kv_count(local)
}

/// Octets à écrire : BOM UTF-8 unique + contenu.
pub fn with_bom(s: &str) -> Vec<u8> {
    let body = s.trim_start_matches(BOM);
    let mut out = Vec::with_capacity(body.len() + 3);
    out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    out.extend_from_slice(body.as_bytes());
    out
}

/// Jusqu'à 3 paires : les témoins présents d'abord, puis les premières lignes non vides.
pub fn preview(s: &str) -> Vec<(String, String)> {
    let pairs: Vec<(&str, &str)> = s.lines().filter_map(kv).filter(|(_, v)| !v.is_empty()).collect();
    let mut out: Vec<(String, String)> = TEMOINS
        .iter()
        .filter_map(|t| pairs.iter().find(|(k, _)| k == t))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    for (k, v) in &pairs {
        if out.len() >= 3 {
            break;
        }
        if !out.iter().any(|(ok, _)| ok == k) {
            out.push((k.to_string(), v.to_string()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_bom_crlf() {
        assert_eq!(normalize("\u{FEFF}a=1\r\nb=2\r\n"), "a=1\nb=2");
        assert!(same_content("\u{FEFF}a=1\r\n", "a=1\n"));
        assert!(!same_content("a=1", "a=2"));
    }

    #[test]
    fn plausible_ok() {
        assert!(is_plausible("# commentaire\nui_CIExit=Quitter le siège\n"));
        assert!(is_plausible("\u{FEFF}mobiGlas_ui_greeble_1,P=MOBIGLAS"));
    }

    #[test]
    fn plausible_html_refuse() {
        assert!(!is_plausible("<!DOCTYPE html><html>a=b</html>"));
        assert!(!is_plausible("\u{FEFF}  <html>a=b"));
    }

    #[test]
    fn plausible_vide_refuse() {
        assert!(!is_plausible(""));
        assert!(!is_plausible("   \n"));
    }

    #[test]
    fn plausible_sans_cle_refuse() {
        assert!(!is_plausible("juste du texte"));
        assert!(!is_plausible("=valeur sans clé"));
    }

    #[test]
    fn bom_unique() {
        let b = with_bom("\u{FEFF}a=1");
        assert_eq!(&b[..3], &[0xEF, 0xBB, 0xBF]);
        assert_ne!(&b[3..6], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(&b[3..], b"a=1");
        assert_eq!(&with_bom("a=1")[3..], b"a=1");
    }

    #[test]
    fn preview_temoins_puis_repli() {
        let ini = "# entête\nfoo=\nbar=Barre\nui_CIExit=Quitter le siège\nbaz=Baz\nqux=Qux\n";
        let p = preview(ini);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0], ("ui_CIExit".to_string(), "Quitter le siège".to_string()));
        assert_eq!(p[1].0, "bar");
        assert_eq!(p[2].0, "baz");
    }

    #[test]
    fn plausible_update_refuse_fichier_tronque() {
        let local: String = (0..100).map(|i| format!("k{i}=v\n")).collect();
        let tronque: String = (0..10).map(|i| format!("k{i}=v\n")).collect();
        let proche: String = (0..80).map(|i| format!("k{i}=w\n")).collect();
        assert!(!plausible_update(&local, &tronque));
        assert!(!plausible_update(&local, "<html>a=b"));
        assert!(plausible_update(&local, &proche));
        assert!(plausible_update("", "a=1"));
    }

    #[test]
    fn preview_cle_avec_virgule() {
        let p = preview("mobiGlas_ui_greeble_1,P=MOBIGLAS V.2\n");
        assert_eq!(p[0], ("mobiGlas_ui_greeble_1,P".to_string(), "MOBIGLAS V.2".to_string()));
    }
}
