// Merge NON destructif du user.cfg : on ne touche qu'à nos 3 lignes gérées, tout le reste
// (optims Vulkan, réglages perso, commentaires) est conservé dans l'ordre.

const LANG: &str = "g_language";
const MANAGED: [&str; 3] = [LANG, "g_languageaudio", "con_restricted"];

/// Ligne débarrassée d'un éventuel BOM (1re ligne d'un fichier UTF-8 avec BOM) et des blancs.
fn clean(l: &str) -> &str {
    l.trim_start_matches('\u{FEFF}').trim()
}

fn is_comment(l: &str) -> bool {
    let t = clean(l);
    ["--", ";", "#", "//"].iter().any(|c| t.starts_with(c))
}

/// Clé d'une ligne `clé = valeur` en minuscules ; None pour un commentaire / une ligne vide.
fn key_of(line: &str) -> Option<String> {
    if is_comment(line) {
        return None;
    }
    clean(line).split_once('=').map(|(k, _)| k.trim().to_lowercase())
}

/// Conserve la fin de ligne du fichier d'origine (CRLF si présent).
fn eol(cfg: &str) -> &'static str {
    if cfg.contains("\r\n") { "\r\n" } else { "\n" }
}

fn rebuild<'a>(lines: impl Iterator<Item = &'a str>, nl: &str) -> String {
    lines.map(|l| format!("{l}{nl}")).collect()
}

/// Valeur active de `g_language`, si réglée.
pub fn current_language(cfg: &str) -> Option<String> {
    cfg.lines()
        .filter(|l| key_of(l).as_deref() == Some(LANG))
        .filter_map(|l| l.split_once('=').map(|(_, v)| v.trim().to_string()))
        .last()
}

/// Remplace nos 3 lignes gérées (casse de clé ignorée) et garde tout le reste.
pub fn merge_language(cfg: &str, folder: &str) -> String {
    let nl = eol(cfg);
    let kept = cfg
        .lines()
        .filter(|l| !key_of(l).is_some_and(|k| MANAGED.contains(&k.as_str())));
    let mut out = rebuild(kept, nl);
    for l in [format!("g_language = {folder}"), "g_languageAudio = english".into(), "Con_Restricted = 0".into()] {
        out.push_str(&l);
        out.push_str(nl);
    }
    out
}

/// Désinstall : retire seulement `g_language` (audio / Con_Restricted restent).
pub fn strip_language(cfg: &str) -> String {
    let kept = cfg.lines().filter(|l| key_of(l).as_deref() != Some(LANG));
    rebuild(kept, eol(cfg))
}

/// Vrai si le fichier ne contient que des blancs / commentaires.
pub fn is_effectively_empty(cfg: &str) -> bool {
    cfg.lines().all(|l| l.trim().is_empty() || is_comment(l))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FR: &str = "french_(france)";

    #[test]
    fn merge_preserve_lignes_tierces() {
        let out = merge_language("r_VSync = 0\nsys_spec = 3\n", FR);
        let vsync = out.find("r_VSync = 0").unwrap();
        let spec = out.find("sys_spec = 3").unwrap();
        let lang = out.find("g_language = french_(france)").unwrap();
        assert!(vsync < spec && spec < lang);
    }

    #[test]
    fn merge_remplace_existantes_casse_mixte() {
        let input = "G_Language = german_(germany)\r\ng_LanguageAudio=german\r\nr_VSync = 0\r\n";
        let out = merge_language(input, FR);
        let low = out.to_lowercase();
        assert_eq!(low.matches("g_language ").count() + low.matches("g_language=").count(), 1);
        assert_eq!(low.matches("g_languageaudio").count(), 1);
        assert_eq!(low.matches("con_restricted").count(), 1);
        assert!(out.contains("g_language = french_(france)"));
        assert!(out.contains("g_languageAudio = english"));
        assert!(out.contains("r_VSync = 0"));
        assert!(!out.contains("german"));
        assert!(out.contains("\r\n"));
        assert_eq!(out.matches('\n').count(), out.matches("\r\n").count());
    }

    #[test]
    fn merge_idempotent() {
        let once = merge_language("r_VSync = 0\ng_language = english\n", FR);
        assert_eq!(merge_language(&once, FR), once);
    }

    #[test]
    fn merge_vide() {
        assert_eq!(
            merge_language("", FR),
            "g_language = french_(france)\ng_languageAudio = english\nCon_Restricted = 0\n"
        );
    }

    #[test]
    fn current_language_lit_valeur() {
        assert_eq!(current_language(" g_language=french_(france) \n").as_deref(), Some(FR));
        assert_eq!(current_language("r_VSync = 0\n"), None);
    }

    #[test]
    fn strip_ne_retire_que_g_language() {
        let out = strip_language("g_language = french_(france)\r\ng_languageAudio = english\r\nCon_Restricted = 0\r\n");
        assert!(!out.to_lowercase().contains("g_language ="));
        assert!(out.contains("g_languageAudio = english"));
        assert!(out.contains("Con_Restricted = 0"));
    }

    #[test]
    fn commentaire_non_pris_pour_cle() {
        let cfg = "-- g_language = x\n";
        assert_eq!(current_language(cfg), None);
        assert!(strip_language(cfg).contains("-- g_language = x"));
        assert!(merge_language(cfg, FR).contains("-- g_language = x"));
    }

    #[test]
    fn bom_user_cfg_detecte() {
        let cfg = "\u{FEFF}g_language = german_(germany)\n";
        assert_eq!(current_language(cfg).as_deref(), Some("german_(germany)"));
        let out = merge_language(cfg, FR);
        assert_eq!(out.to_lowercase().matches("g_language =").count(), 1);
        assert!(!out.contains("german"));
    }

    #[test]
    fn vide_effectif() {
        assert!(is_effectively_empty("  \r\n-- commentaire\n; autre\n"));
        assert!(!is_effectively_empty("r_VSync = 0"));
    }
}
