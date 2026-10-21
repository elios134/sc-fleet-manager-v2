use serde_json::{json, Value};

/// Expression régulière constante compilée UNE fois par site d'appel (et non à chaque ligne
/// du Game.log). Motifs littéraux : une erreur de syntaxe ferait échouer les tests.
macro_rules! re {
    ($pat:expr) => {{
        static RE: std::sync::LazyLock<regex::Regex> =
            std::sync::LazyLock::new(|| regex::Regex::new($pat).expect("regex Game.log invalide"));
        &*RE
    }};
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedEvent {
    pub kind: &'static str,
    pub summary: String,
    pub detail: Value,
    pub occurred_at: Option<String>,
}

/// Horodatage en tête de ligne : `<2026-06-27T16:00:00.000Z> …`.
fn timestamp(line: &str) -> Option<String> {
    let re = re!(r"^<([0-9T:\.\-]+Z)>");
    re.captures(line)?.get(1).map(|m| m.as_str().to_string())
}

/// Mort d'acteur (format documenté `<Actor Death> CActor::Kill: …`).
fn parse_death(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    let re = re!(r"CActor::Kill: '([^']+)' \[\d+\] in zone '([^']*)' killed by '([^']+)' \[\d+\] using '([^']+)'");
    let c = re.captures(line)?;
    let victim = c.get(1)?.as_str();
    let zone = c.get(2)?.as_str();
    let killer = c.get(3)?.as_str();
    let weapon = c.get(4)?.as_str();
    let summary = if victim == killer {
        format!("{victim} s'est auto-détruit ({zone})")
    } else {
        format!("{victim} tué par {killer} — {weapon}")
    };
    Some(ParsedEvent {
        kind: "death",
        summary,
        detail: json!({ "victim": victim, "killer": killer, "weapon": weapon, "zone": zone }),
        occurred_at: ts.clone(),
    })
}

/// Fin de mission (`<EndMission>` / `<MissionEnded>`, avec `MissionId[…]` puis
/// `CompletionType[…]`). CompletionType → issue : Complete=completed, Abandon=abandoned,
/// tout le reste (Fail/Failed/Incomplete/Cancelled…) = failed. Motif calqué sur
/// MultitoolV2 — format exact à confirmer sur un log PU réel.
fn parse_mission(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    if !line.contains("<EndMission>") && !line.contains("<MissionEnded>") {
        return None;
    }
    let re = re!(r"MissionId\[([^\]]+)\].*?CompletionType\[(\w+)\]");
    let c = re.captures(line)?;
    let mission_id = c.get(1)?.as_str().trim();
    let completion = c.get(2)?.as_str().trim();
    let outcome = match completion {
        "Complete" => "completed",
        "Abandon" => "abandoned",
        _ => "failed",
    };
    let label = match outcome {
        "completed" => "Mission terminée",
        "abandoned" => "Mission abandonnée",
        _ => "Mission échouée",
    };
    Some(ParsedEvent {
        kind: "mission",
        summary: label.to_string(),
        detail: json!({ "missionId": mission_id, "outcome": outcome, "completionType": completion }),
        occurred_at: ts.clone(),
    })
}

/// Apparition d'un vaisseau (réel SC 4.x : `[VEHICLE SPAWN] … OnVehicleSpawned <id>
/// (<NomVaisseau>_<id>) by player`). Le suffixe `_<digits>` est l'entityId, on le retire.
fn parse_vehicle_spawn(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    if !line.contains("OnVehicleSpawned") {
        return None;
    }
    let re = re!(r"OnVehicleSpawned\s+\d+\s+\(([A-Za-z0-9_]+?)_\d+\)");
    let vehicle = re.captures(line)?.get(1)?.as_str();
    Some(ParsedEvent {
        kind: "vehicle",
        summary: format!("Vaisseau apparu : {vehicle}"),
        detail: json!({ "vehicle": vehicle, "event": "spawn" }),
        occurred_at: ts.clone(),
    })
}

/// Destruction de véhicule (`<Vehicle Destruction>` / CVehicle::OnAdvanceDestroyLevel).
fn parse_vehicle_destruction(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    if !line.contains("Vehicle Destruction") && !line.contains("OnAdvanceDestroyLevel") {
        return None;
    }
    let vehicle = re!(r"[Vv]ehicle '([^']+)'")
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    Some(ParsedEvent {
        kind: "vehicle",
        summary: match &vehicle {
            Some(v) => format!("Véhicule détruit : {v}"),
            None => "Véhicule détruit".to_string(),
        },
        detail: json!({ "vehicle": vehicle, "event": "destruction" }),
        occurred_at: ts.clone(),
    })
}

/// Connexion / personnage actif (réel : `<AccountLoginCharacterStatus_Character> Character:
/// … name <handle> - state STATE_CURRENT`). Marque le début de session.
fn parse_login(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    if !line.contains("AccountLoginCharacterStatus_Character") {
        return None;
    }
    let re = re!(r"name\s+(\S+)\s+-\s+state STATE_CURRENT");
    let name = re.captures(line)?.get(1)?.as_str();
    Some(ParsedEvent {
        kind: "session",
        summary: format!("Connexion : {name}"),
        detail: json!({ "character": name }),
        occurred_at: ts.clone(),
    })
}

/// Mode de jeu (réel : `Requesting game mode <Map>/<Mode>`). On garde le mode (2e segment).
fn parse_gamemode(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    let re = re!(r"Requesting game mode \S+/(\S+)");
    let mode = re.captures(line)?.get(1)?.as_str();
    let label = match mode {
        "SC_Frontend" => "Menu principal".to_string(),
        "EA_FreeFlight" => "Vol libre".to_string(),
        _ => mode.to_string(),
    };
    Some(ParsedEvent {
        kind: "activity",
        summary: format!("Mode de jeu : {label}"),
        detail: json!({ "gameMode": mode }),
        occurred_at: ts.clone(),
    })
}

/// Écran de chargement (réel : `Loading screen for <Cible> : <Mode> closed/Started`).
/// La cible sert de LIEU dans le PU (on ignore le menu et l'Arena Commander `EA_…`).
fn parse_location(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    // Inventaire ouvert en jeu : lieu précis (`Location[RR_CRU_LEO]`, `Location[Stanton4_NewBabbage]`).
    let inv = re!(r"requested inventory for Location\[([A-Za-z0-9_]+)\]");
    if let Some(zone) = inv.captures(line).and_then(|c| c.get(1)) {
        return Some(ParsedEvent {
            kind: "location",
            summary: format!("Lieu : {}", zone.as_str()),
            detail: json!({ "zone": zone.as_str() }),
            occurred_at: ts.clone(),
        });
    }
    let re = re!(r"Loading screen for ([A-Za-z0-9_]+)");
    let target = re.captures(line)?.get(1)?.as_str();
    // Le PU pose une cible « réelle » ; le menu (Frontend_*) et l'AC (EA_*) ne sont
    // pas des lieux exploitables par le GPS → on les classe en simple activité.
    let is_pu_location = !target.starts_with("Frontend") && !target.starts_with("EA_");
    if is_pu_location {
        Some(ParsedEvent {
            kind: "location",
            summary: format!("Lieu : {target}"),
            detail: json!({ "zone": target }),
            occurred_at: ts.clone(),
        })
    } else {
        Some(ParsedEvent {
            kind: "activity",
            summary: format!("Chargement : {target}"),
            detail: json!({ "loading": target }),
            occurred_at: ts.clone(),
        })
    }
}

/// Voyage quantique RÉEL uniquement (on écarte le bruit `[QuantumTravel] … No Route
/// loaded!`). On exige un marqueur de voyage effectif.
fn parse_quantum(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    let is_real_qt = line.contains("Entering Quantum")
        || line.contains("Quantum Travel to")
        || line.contains("QT Started")
        || (line.contains("QuantumTravel") && line.contains("destination"));
    if !is_real_qt {
        return None;
    }
    let dest = re!(r"(?:to|destination)[ '\[:=]+([A-Za-z0-9_@\-]+)")
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    Some(ParsedEvent {
        kind: "quantum",
        summary: match &dest {
            Some(d) => format!("Saut quantique → {d}"),
            None => "Saut quantique".to_string(),
        },
        detail: json!({ "destination": dest }),
        occurred_at: ts.clone(),
    })
}

/// Transaction marchande (achat/vente de cargo). CONSERVATEUR : exige le marqueur
/// « commodity » + un verbe d'action pour éviter tout faux positif. Les formats exacts
/// des kiosques marchands varient selon les patchs SC — motifs à ajuster sur logs réels.
/// detail : { action, commodity, scu, unitPrice, totalPrice, location }.
fn parse_commodity(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    let lower = line.to_lowercase();
    if !lower.contains("commodity") {
        return None;
    }
    let action = if lower.contains("purchase") || lower.contains("bought") {
        "buy"
    } else if lower.contains("sold") || lower.contains("sell") {
        "sell"
    } else {
        return None;
    };
    let cap1 = |re: &str| {
        regex::Regex::new(re)
            .ok()
            .and_then(|r| r.captures(line))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    };
    let commodity = cap1(r"[Cc]ommodity[ '\[:=]+([A-Za-z0-9_@\- ]+?)['\]]").unwrap_or_default();
    let scu = cap1(r"([0-9]+(?:\.[0-9]+)?)\s*SCU").and_then(|s| s.parse::<f64>().ok());
    let total = cap1(r"(?:for|total|price)[ :=]+\$?([0-9]+(?:\.[0-9]+)?)")
        .and_then(|s| s.parse::<f64>().ok());
    let unit = match (total, scu) {
        (Some(t), Some(s)) if s > 0.0 => Some(t / s),
        _ => None,
    };
    let kind = if action == "buy" { "commodity_buy" } else { "commodity_sell" };
    let label = if action == "buy" { "Achat" } else { "Vente" };
    let summary = if commodity.is_empty() {
        format!("{label} de cargo")
    } else {
        format!("{label} : {commodity}{}", scu.map(|s| format!(" ({s} SCU)")).unwrap_or_default())
    };
    Some(ParsedEvent {
        kind,
        summary,
        detail: json!({
            "action": action,
            "commodity": commodity,
            "scu": scu,
            "unitPrice": unit,
            "totalPrice": total,
        }),
        occurred_at: ts.clone(),
    })
}

/// Changement de système solaire (PU). STRICT : exige « Changing Solar System » pour
/// éviter le bruit (« Seed Solar System », « DefaultSolarSystem »…). Motif à confirmer
/// sur un log PU réel.
fn parse_system(line: &str, ts: &Option<String>) -> Option<ParsedEvent> {
    if !line.contains("Changing Solar System") {
        return None;
    }
    let sys = re!(r"(?:to|System)[ '\[:=]+([A-Za-z][A-Za-z0-9_\-]+)")
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())?;
    Some(ParsedEvent {
        kind: "system",
        summary: format!("Changement de système : {sys}"),
        detail: json!({ "system": sys }),
        occurred_at: ts.clone(),
    })
}

/// Parse une ligne en un événement, ou None si non reconnue. L'ordre = priorité.
pub fn parse_line(line: &str) -> Option<ParsedEvent> {
    let line = line.trim_end();
    if line.is_empty() {
        return None;
    }
    let ts = timestamp(line);
    parse_death(line, &ts)
        .or_else(|| parse_mission(line, &ts))
        .or_else(|| parse_commodity(line, &ts))
        .or_else(|| parse_vehicle_spawn(line, &ts))
        .or_else(|| parse_vehicle_destruction(line, &ts))
        .or_else(|| parse_login(line, &ts))
        .or_else(|| parse_quantum(line, &ts))
        .or_else(|| parse_system(line, &ts))
        .or_else(|| parse_gamemode(line, &ts))
        .or_else(|| parse_location(line, &ts))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tous_les_motifs_se_compilent() {
        // Une ligne par filtre : chaque `re!` est évalué au moins une fois (un motif
        // invalide paniquerait ici plutôt que dans la surveillance du Game.log).
        for line in [
            "<2026-01-01T00:00:00.000Z> rien",
            "<2026-01-01T00:00:00.000Z> Vehicle Destruction vehicle 'ANVL_C8_1'",
            "<2026-01-01T00:00:00.000Z> Quantum Travel to destination 'Stanton2'",
            "<2026-01-01T00:00:00.000Z> Changing Solar System to Pyro",
            "<2026-01-01T00:00:00.000Z> OnVehicleSpawned 1 (ANVL_C8_1)",
        ] {
            let _ = parse_line(line);
        }
    }

    #[test]
    fn inventaire_ouvert_donne_le_lieu() {
        let line = "<2026-10-10T21:08:49.320Z> [Notice] <RequestLocationInventory> Player[pilote] requested inventory for Location[RR_CRU_LEO] [Team_CoreGameplayFeatures][Inventory]";
        let ev = parse_line(line).expect("lieu parsé");
        assert_eq!(ev.kind, "location");
        assert_eq!(ev.detail["zone"], "RR_CRU_LEO");
    }

    #[test]
    fn parses_actor_death() {
        let line = "<2026-06-27T16:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'Jdoe' [12345] in zone 'Stanton_Hurston' killed by 'Pirate_NPC' [67890] using 'ballistic_rifle' [Class Weapon] with damage type 'Bullet'";
        let ev = parse_line(line).expect("death parsé");
        assert_eq!(ev.kind, "death");
        assert_eq!(ev.detail["victim"], "Jdoe");
        assert_eq!(ev.detail["killer"], "Pirate_NPC");
        assert_eq!(ev.detail["weapon"], "ballistic_rifle");
        assert_eq!(ev.occurred_at.as_deref(), Some("2026-06-27T16:00:00.000Z"));
    }

    #[test]
    fn suicide_summary_differs() {
        let line = "<2026-06-27T16:00:00.000Z> <Actor Death> CActor::Kill: 'Jdoe' [1] in zone 'Area18' killed by 'Jdoe' [1] using 'Suicide'";
        let ev = parse_line(line).expect("death parsé");
        assert!(ev.summary.contains("auto-détruit"));
    }

    #[test]
    fn parses_end_mission_complete() {
        let line = "<2026-06-27T16:05:00.000Z> [Notice] <EndMission> Mission ended MissionId[a1b2-c3d4] name[Bounty] CompletionType[Complete] [Team_Mission]";
        let ev = parse_line(line).expect("mission parsée");
        assert_eq!(ev.kind, "mission");
        assert_eq!(ev.detail["outcome"], "completed");
        assert_eq!(ev.detail["missionId"], "a1b2-c3d4");
    }

    #[test]
    fn end_mission_fail_maps_to_failed() {
        let line = "<2026-06-27T16:06:00.000Z> <MissionEnded> MissionId[x9] CompletionType[Fail]";
        let ev = parse_line(line).expect("mission parsée");
        assert_eq!(ev.detail["outcome"], "failed");
    }

    #[test]
    fn parses_real_vehicle_spawn() {
        // Ligne RÉELLE d'un Game.log SC 4.8.
        let line = "<2026-06-22T21:59:32.042Z> [VEHICLE SPAWN] CPlayerShipRespawnManager::OnVehicleSpawned 200000002321 (ORIG_m80_200000002321) by player 0 ";
        let ev = parse_line(line).expect("vehicle spawn parsé");
        assert_eq!(ev.kind, "vehicle");
        assert_eq!(ev.detail["vehicle"], "ORIG_m80");
    }

    #[test]
    fn parses_real_login() {
        let line = "<2026-06-22T21:59:06.405Z> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1778727425393 - updatedAt 1781727215670 - geid 204100470772 - accountId 4788399 - name elios5 - state STATE_CURRENT [Team_GameServices][Login]";
        let ev = parse_line(line).expect("login parsé");
        assert_eq!(ev.kind, "session");
        assert_eq!(ev.detail["character"], "elios5");
    }

    #[test]
    fn parses_real_gamemode() {
        let line = "<2026-06-22T21:59:21.600Z> Requesting game mode EA_TheGoodDr/EA_FreeFlight";
        let ev = parse_line(line).expect("game mode parsé");
        assert_eq!(ev.kind, "activity");
        assert_eq!(ev.detail["gameMode"], "EA_FreeFlight");
    }

    #[test]
    fn ignores_quantum_noise() {
        // Le bruit « No Route loaded! [QuantumTravel] » ne DOIT PAS être détecté.
        let line = "<2026-06-22T21:59:32.675Z> [Notice] <Failed to get starmap route data!> [ItemNavigation][CL][35200] | AUTH | ORIG_m80_200000002321|CSCItemNavigation::GetStarmapRouteSegmentData|No Route loaded! [Team_CGP4][QuantumTravel]";
        // Peut matcher vehicle (ORIG_m80_…) ? Non : pas de OnVehicleSpawned. → None.
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert!(parse_line("<2026-06-27T16:02:00.000Z> [Notice] <CrashHandler> nothing here").is_none());
        assert!(parse_line("").is_none());
    }
}
