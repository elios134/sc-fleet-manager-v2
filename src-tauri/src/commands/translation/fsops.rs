// I/O disque BORNÉE : seules cibles = <canal>/data/Localization/<folder>/global.ini,
// <canal>/user.cfg et <canal>/user.cfg.bak. Aucune autre écriture dans l'install SC.
use std::io;
use std::path::{Path, PathBuf};

use crate::commands::patch_detect::{is_valid_install, CHANNELS};
use crate::commands::translation::{cfg::is_effectively_empty, ini::with_bom};

/// Canaux SC présents sous la racine d'install (`…/StarCitizen/LIVE` etc., Data.p4k requis).
pub fn list_channels(root: &Path) -> Vec<(String, PathBuf)> {
    CHANNELS
        .iter()
        .map(|c| (c.to_string(), root.join(c)))
        .filter(|(_, p)| p.to_str().is_some_and(is_valid_install))
        .collect()
}

/// `folder` doit être un simple nom de dossier (aucune remontée / sous-chemin).
fn safe_folder(folder: &str) -> io::Result<&str> {
    // Un seul composant « normal » ; « : » refusé (chemin relatif à un lecteur sous Windows).
    let mut comps = Path::new(folder).components();
    let single = matches!((comps.next(), comps.next()), (Some(std::path::Component::Normal(_)), None));
    let ok = single && !folder.contains([':', '/', '\\']);
    if ok { Ok(folder) } else { Err(io::Error::new(io::ErrorKind::InvalidInput, "dossier de langue invalide")) }
}

fn loc_dir(channel: &Path, folder: &str) -> io::Result<PathBuf> {
    Ok(channel.join("data").join("Localization").join(safe_folder(folder)?))
}

/// Écrit le global.ini (UTF-8 + BOM) via un fichier temporaire puis renommage.
/// Seulement dans une install valide : ne recrée jamais un canal supprimé.
pub fn write_global_ini(channel: &Path, folder: &str, content: &str) -> io::Result<()> {
    if !channel.to_str().is_some_and(is_valid_install) {
        return Err(io::Error::new(io::ErrorKind::NotFound, "canal Star Citizen introuvable (Data.p4k absent)"));
    }
    let dir = loc_dir(channel, folder)?;
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("global.ini.tmp");
    std::fs::write(&tmp, with_bom(content))?;
    std::fs::rename(&tmp, dir.join("global.ini"))
}

pub fn read_global_ini(channel: &Path, folder: &str) -> Option<String> {
    std::fs::read_to_string(loc_dir(channel, folder).ok()?.join("global.ini")).ok()
}

/// Lecture stricte avant toute écriture : absent = "", refuse un fichier non UTF-8 ou UTF-16
/// (sinon notre merge produirait un fichier à encodage mixte).
pub fn read_cfg_strict(channel: &Path) -> io::Result<String> {
    let path = channel.join("user.cfg");
    if !path.is_file() {
        return Ok(String::new());
    }
    let bad = || io::Error::new(io::ErrorKind::InvalidData, "user.cfg illisible (encodage non UTF-8)");
    let s = String::from_utf8(std::fs::read(&path)?).map_err(|_| bad())?;
    if s.contains('\0') {
        return Err(bad());
    }
    Ok(s)
}

pub fn read_cfg(channel: &Path) -> String {
    std::fs::read_to_string(channel.join("user.cfg")).unwrap_or_default()
}

/// Réécrit user.cfg = f(existant), après copie de l'existant en user.cfg.bak.
/// N'en crée pas un s'il n'existait pas et que le résultat ne contient rien d'utile.
pub fn apply_cfg(channel: &Path, f: impl Fn(&str) -> String) -> io::Result<()> {
    let path = channel.join("user.cfg");
    let exists = path.is_file();
    let old = read_cfg_strict(channel)?;
    let new = f(&old);
    if !exists && is_effectively_empty(&new) {
        return Ok(());
    }
    if exists {
        std::fs::copy(&path, channel.join("user.cfg.bak"))?;
    }
    std::fs::write(&path, new)
}

/// Supprime data/Localization/<folder> et rien d'autre (absent = OK).
pub fn remove_localization(channel: &Path, folder: &str) -> io::Result<()> {
    let dir = loc_dir(channel, folder)?;
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("scfm-trad-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("Data.p4k"), "").unwrap();
        d
    }

    #[test]
    fn write_refuse_drive_relatif() {
        let ch = tmp("drive");
        assert!(write_global_ini(&ch, "C:evil", "a=1").is_err());
        assert!(remove_localization(&ch, "C:evil").is_err());
    }

    #[test]
    fn write_refuse_canal_sans_data_p4k() {
        let ch = tmp("nop4k");
        fs::remove_file(ch.join("Data.p4k")).unwrap();
        assert!(write_global_ini(&ch, "french_(france)", "a=1").is_err());
        assert!(!ch.join("data").exists());
    }

    #[test]
    fn read_cfg_strict_refuse_encodage() {
        let ch = tmp("enc");
        assert_eq!(read_cfg_strict(&ch).unwrap(), "");
        fs::write(ch.join("user.cfg"), [0x2D, 0x2D, 0x20, 0xE9, 0x0A]).unwrap(); // ANSI « é »
        assert!(read_cfg_strict(&ch).is_err());
        fs::write(ch.join("user.cfg"), [0xFF, 0xFE, 0x67, 0x00, 0x3D, 0x00]).unwrap(); // UTF-16
        assert!(read_cfg_strict(&ch).is_err());
        fs::write(ch.join("user.cfg"), "g=1\n").unwrap();
        assert_eq!(read_cfg_strict(&ch).unwrap(), "g=1\n");
    }

    #[test]
    fn ecrit_global_ini_avec_bom() {
        let ch = tmp("bom");
        write_global_ini(&ch, "french_(france)", "a=1").unwrap();
        let b = fs::read(ch.join("data/Localization/french_(france)/global.ini")).unwrap();
        assert_eq!(&b[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(read_global_ini(&ch, "french_(france)").as_deref(), Some("\u{FEFF}a=1"));
        assert!(!ch.join("data/Localization/french_(france)/global.ini.tmp").exists());
    }

    #[test]
    fn apply_cfg_cree_bak() {
        let ch = tmp("bak");
        fs::write(ch.join("user.cfg"), "r_VSync = 0\n").unwrap();
        apply_cfg(&ch, |c| crate::commands::translation::cfg::merge_language(c, "french_(france)")).unwrap();
        assert_eq!(fs::read_to_string(ch.join("user.cfg.bak")).unwrap(), "r_VSync = 0\n");
        assert!(read_cfg(&ch).contains("g_language = french_(france)"));
        assert!(read_cfg(&ch).contains("r_VSync = 0"));
    }

    #[test]
    fn apply_cfg_absent_cree() {
        let ch = tmp("absent");
        apply_cfg(&ch, |c| crate::commands::translation::cfg::merge_language(c, "french_(france)")).unwrap();
        assert!(read_cfg(&ch).contains("g_language = french_(france)"));
        assert!(!ch.join("user.cfg.bak").exists());
    }

    #[test]
    fn apply_cfg_absent_vide_n_ecrit_rien() {
        let ch = tmp("absent-vide");
        apply_cfg(&ch, |c| crate::commands::translation::cfg::strip_language(c)).unwrap();
        assert!(!ch.join("user.cfg").exists());
    }

    #[test]
    fn remove_refuse_traversal() {
        let ch = tmp("traversal");
        fs::write(ch.join("user.cfg"), "x=1").unwrap();
        for bad in ["..", "", "a/b", "a\\b", "../data", "C:evil"] {
            assert!(remove_localization(&ch, bad).is_err(), "{bad}");
        }
        assert!(ch.join("user.cfg").exists());
    }

    #[test]
    fn remove_ne_touche_que_le_folder() {
        let ch = tmp("remove");
        write_global_ini(&ch, "french_(france)", "a=1").unwrap();
        write_global_ini(&ch, "english", "a=1").unwrap();
        remove_localization(&ch, "french_(france)").unwrap();
        assert!(!ch.join("data/Localization/french_(france)").exists());
        assert!(ch.join("data/Localization/english/global.ini").exists());
        // Déjà absent : pas une erreur.
        remove_localization(&ch, "french_(france)").unwrap();
    }

    #[test]
    fn list_channels_filtre_data_p4k() {
        let root = tmp("channels");
        fs::create_dir_all(root.join("LIVE")).unwrap();
        fs::write(root.join("LIVE/Data.p4k"), "").unwrap();
        fs::create_dir_all(root.join("PTU")).unwrap();
        let ch = list_channels(&root);
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0].0, "LIVE");
        assert_eq!(ch[0].1, root.join("LIVE"));
    }
}
