// Analyse du HTML des pages pledges RSI (pledges, vaisseaux, objets, CCU) et du handle.

use super::*;

/* ──────────────────────────────  Helpers parsing  ─────────────────────────── */

/// Première occurrence d'un sélecteur → valeur d'attribut, trim, non vide.
pub(super) fn first_attr(el: ElementRef, sel: &Selector, attr: &str) -> Option<String> {
    el.select(sel)
        .next()
        .and_then(|e| e.value().attr(attr))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Première occurrence d'un sélecteur → texte concaténé, trim, non vide.
pub(super) fn first_text(el: ElementRef, sel: &Selector) -> Option<String> {
    el.select(sel)
        .next()
        .map(|e| e.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Extrait l'URL d'un `background-image: url(...)`. Préfixe l'origine RSI si relatif.
pub(super) fn bg_url(style: &str, re_bg: &Regex) -> Option<String> {
    let url = re_bg.captures(style)?.get(1)?.as_str().trim();
    if url.is_empty() {
        return None;
    }
    if url.starts_with('/') {
        Some(format!("{RSI_BASE_URL}{url}"))
    } else {
        Some(url.to_string())
    }
}

/// Retire le suffixe " (CODE)" d'un nom de fabricant.
pub(super) fn strip_paren_suffix(s: &str, re_paren: &Regex) -> String {
    re_paren.replace(s, "").trim().to_string()
}

#[derive(Clone)]
pub(super) struct NameableShip {
    membership_id: String,
    custom_name: Option<String>,
}

/// Parse le `<script class="js-pledge-nameable-ships">` (array JSON) → map par default_name.
pub(super) fn parse_nameable(json_text: &str) -> HashMap<String, NameableShip> {
    let mut map = HashMap::new();
    let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(json_text) else {
        return map;
    };
    for entry in arr {
        let Some(default_name) = entry.get("default_name").and_then(|v| v.as_str()) else {
            continue;
        };
        let membership_id = match entry.get("membership_id") {
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::String(s)) => s.clone(),
            _ => continue,
        };
        let custom_name = entry
            .get("custom_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        map.insert(
            default_name.to_string(),
            NameableShip {
                membership_id,
                custom_name,
            },
        );
    }
    map
}

/* ──────────────────────────────  Parsing principal  ───────────────────────── */

pub(super) fn parse_pledge_html(html: &str) -> Vec<ScrapedPledge> {
    let doc = Html::parse_document(html);

    // Sélecteurs (compilés une fois par page).
    let s = |sel: &str| Selector::parse(sel).unwrap();
    let sel_card = s(".list-items li");
    let sel_pid = s("input.js-pledge-id");
    let sel_pname = s("input.js-pledge-name");
    let sel_pvalue = s("input.js-pledge-value");
    let sel_pcurrency = s("input.js-pledge-currency");
    let sel_pnotbb = s("input.js-pledge-not-buybackable");
    let sel_upgraded = s("h3.upgraded, span.upgraded");
    let sel_datecol = s(".date-col");
    let sel_basicimg = s(".basic-infos .item-image-wrapper .image");
    let sel_nameable = s("script.js-pledge-nameable-ships");
    let sel_item = s(".items .with-images .item");
    let sel_item_textonly = s(".items .without-images .item");
    let sel_title = s(".title");
    let sel_kind = s(".kind");
    let sel_liner = s(".liner");
    let sel_liner_code = s(".liner span");
    let sel_image = s(".image");
    let sel_upg_rows = s("#pledge-upgrade-log .pledge-upgrade-log-rows .row");
    let sel_upg_label = s("label");

    // Regex (compilées une fois par page).
    let re_value = Regex::new(r"^\$?([\d,]+\.\d{2})\s+([A-Z]{3})$").unwrap();
    let re_bg = Regex::new(r#"background-image:\s*url\(['"]?([^'")]+)['"]?\)"#).unwrap();
    let re_created = Regex::new(r"(?i)created:").unwrap();
    let re_ins = Regex::new(r"(?i)^(\d+)\s+Month\s+Insurance$").unwrap();
    let re_paren = Regex::new(r"\s*\([^)]*\)\s*$").unwrap();
    let re_upg = Regex::new(
        r"Upgrade applied:\s*#(\d+)\s+Upgrade\s+-\s+(.+?)\s+to\s+(.+?)\s+Standard Edition,\s+new value:\s+\$([\d,]+\.\d{2})\s+USD",
    )
    .unwrap();

    let mut out = Vec::new();

    for card in doc.select(&sel_card) {
        // rsiPledgeId obligatoire (filtre aussi les <li> imbriqués non-cartes).
        let Some(rsi_pledge_id) = first_attr(card, &sel_pid, "value") else {
            continue;
        };

        let name = first_attr(card, &sel_pname, "value").unwrap_or_default();

        // Valeur + devise.
        let value_raw = first_attr(card, &sel_pvalue, "value").unwrap_or_default();
        let (current_value_usd, value_currency) = match re_value.captures(value_raw.trim()) {
            Some(c) => (
                c.get(1)
                    .and_then(|m| m.as_str().replace(',', "").parse::<f64>().ok()),
                c.get(2).map(|m| m.as_str().to_string()),
            ),
            None => (None, None),
        };
        let currency = first_attr(card, &sel_pcurrency, "value").or(value_currency);

        // Buybackable : "0" (ou absent) ⇒ rachetable.
        let not_bb = first_attr(card, &sel_pnotbb, "value").unwrap_or_else(|| "0".to_string());
        let is_buybackable = not_bb.trim() == "0";

        let is_upgraded = card.select(&sel_upgraded).next().is_some();

        let created_date = first_text(card, &sel_datecol)
            .map(|t| re_created.replace(&t, "").trim().to_string())
            .filter(|s| !s.is_empty());

        let pledge_image_url = card
            .select(&sel_basicimg)
            .next()
            .and_then(|e| e.value().attr("style"))
            .and_then(|style| bg_url(style, &re_bg));

        // JSON des navires nommables.
        let nameable = card
            .select(&sel_nameable)
            .next()
            .map(|e| parse_nameable(&e.text().collect::<String>()))
            .unwrap_or_default();

        // ── Insurance (lti / insuranceMonths) ──
        let mut lti = false;
        let mut insurance_months: Option<i64> = None;
        for item in card.select(&sel_item) {
            if first_text(item, &sel_kind).as_deref() != Some("Insurance") {
                continue;
            }
            let title = first_text(item, &sel_title).unwrap_or_default();
            if title == "Lifetime Insurance" {
                lti = true;
                insurance_months = None;
                break;
            }
            if let Some(c) = re_ins.captures(&title) {
                lti = false;
                insurance_months = c.get(1).and_then(|m| m.as_str().parse::<i64>().ok());
            }
        }

        // ── Ships ──
        let mut ships = Vec::new();
        for item in card.select(&sel_item) {
            if first_text(item, &sel_kind).as_deref() != Some("Ship") {
                continue;
            }
            let Some(ship_name) = first_text(item, &sel_title) else {
                continue;
            };
            let liner_full = first_text(item, &sel_liner).unwrap_or_default();
            let manufacturer = {
                let m = strip_paren_suffix(&liner_full, &re_paren);
                if m.is_empty() {
                    "Unknown".to_string()
                } else {
                    m
                }
            };
            let manufacturer_code = first_text(item, &sel_liner_code);
            let image_url = item
                .select(&sel_image)
                .next()
                .and_then(|e| e.value().attr("style"))
                .and_then(|style| bg_url(style, &re_bg));

            let nm = nameable.get(&ship_name);
            ships.push(ScrapedShip {
                ship_name,
                manufacturer,
                manufacturer_code,
                image_url,
                membership_id: nm.map(|n| n.membership_id.clone()),
                custom_name: nm.and_then(|n| n.custom_name.clone()),
                is_nameable: nm.is_some(),
            });
        }

        // ── Items (cosmétiques) — 2 passes ──
        let mut items = Vec::new();
        // 1. Avec images, hors Ship / Insurance.
        for item in card.select(&sel_item) {
            let kind = first_text(item, &sel_kind);
            if matches!(kind.as_deref(), Some("Ship") | Some("Insurance")) {
                continue;
            }
            let Some(title) = first_text(item, &sel_title) else {
                continue;
            };
            let manufacturer = first_text(item, &sel_liner)
                .map(|l| strip_paren_suffix(&l, &re_paren))
                .filter(|s| !s.is_empty());
            let image_url = item
                .select(&sel_image)
                .next()
                .and_then(|e| e.value().attr("style"))
                .and_then(|style| bg_url(style, &re_bg));
            items.push(ScrapedItem {
                title,
                kind,
                image_url,
                manufacturer,
            });
        }
        // 2. Texte seul.
        for item in card.select(&sel_item_textonly) {
            let title = first_text(item, &sel_title)
                .unwrap_or_else(|| item.text().collect::<String>().trim().to_string());
            if title.is_empty() {
                continue;
            }
            items.push(ScrapedItem {
                title,
                kind: None,
                image_url: None,
                manufacturer: None,
            });
        }

        // ── Upgrades (log CCU) ──
        let mut upgrades = Vec::new();
        for row in card.select(&sel_upg_rows) {
            let Some(label) = first_text(row, &sel_upg_label) else {
                continue;
            };
            let normalized = label.split_whitespace().collect::<Vec<_>>().join(" ");
            let Some(idx) = normalized.find("Upgrade applied") else {
                continue;
            };
            let date_part = normalized[..idx].trim().to_string();
            let action_part = &normalized[idx..];
            let applied_at = if date_part.is_empty() {
                None
            } else {
                Some(date_part)
            };
            match re_upg.captures(action_part) {
                Some(c) => upgrades.push(ScrapedUpgrade {
                    applied_at,
                    ccu_id: c.get(1).map(|m| m.as_str().to_string()),
                    from_ship_name: c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
                    to_ship_name: c.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
                    new_pledge_value: c
                        .get(4)
                        .and_then(|m| m.as_str().replace(',', "").parse::<f64>().ok()),
                }),
                None => upgrades.push(ScrapedUpgrade {
                    applied_at,
                    ccu_id: None,
                    from_ship_name: String::new(),
                    to_ship_name: String::new(),
                    new_pledge_value: None,
                }),
            }
        }

        // Type inféré depuis le contenu.
        let pledge_type = if ships.len() > 1 {
            "game_package"
        } else if ships.len() == 1 {
            "standalone_ship"
        } else {
            "cosmetic"
        }
        .to_string();

        out.push(ScrapedPledge {
            rsi_pledge_id,
            name,
            pledge_type,
            current_value_usd,
            currency,
            is_upgraded,
            is_buybackable,
            created_date,
            pledge_image_url,
            lti,
            insurance_months,
            ships,
            items,
            upgrades,
        });
    }

    out
}

/* ──────────────────────────────  Handle depuis le HTML  ───────────────────── */

/// Extrait le handle RSI depuis le HTML d'une page pledges (source fiable : c'est le
/// contenu réellement chargé, contrairement à un eval séparé sujet au timing).
/// Priorité au lien dossier citoyen `a[data-cy-id="link-citizen-dossier"]`, sinon
/// n'importe quel lien `/citizens/<handle>`, sinon regex sur tout le HTML.
pub(super) fn extract_handle_from_html(html: &str) -> Option<String> {
    let re = Regex::new(r#"/citizens/([^/"?#]+)"#).ok()?;
    let doc = Html::parse_document(html);

    let cy = Selector::parse(r#"a[data-cy-id="link-citizen-dossier"]"#).ok();
    let any = Selector::parse(r#"a[href*="/citizens/"]"#).ok();

    for sel in [cy, any].into_iter().flatten() {
        if let Some(a) = doc.select(&sel).next() {
            if let Some(href) = a.value().attr("href") {
                if let Some(c) = re.captures(href) {
                    let h = c[1].trim();
                    if !h.is_empty() {
                        return Some(h.to_string());
                    }
                }
            }
        }
    }

    // Repli : premier /citizens/<handle> trouvé dans le HTML brut.
    re.captures(html).and_then(|c| {
        let h = c[1].trim();
        if h.is_empty() {
            None
        } else {
            Some(h.to_string())
        }
    })
}
