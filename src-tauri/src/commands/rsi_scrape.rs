use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const PLEDGES_BASE: &str = "https://robertsspaceindustries.com/en/account/pledges";
const MAX_PAGES: u32 = 50;
const RSI_BASE_URL: &str = "https://robertsspaceindustries.com";

/* ──────────────────────────────  Structs  ────────────────────────────────── */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedPledge {
    rsi_pledge_id: String,
    name: String,
    pledge_type: String,
    current_value_usd: Option<f64>,
    currency: Option<String>,
    is_upgraded: bool,
    is_buybackable: bool,
    created_date: Option<String>,
    pledge_image_url: Option<String>,
    lti: bool,
    insurance_months: Option<i64>,
    ships: Vec<ScrapedShip>,
    items: Vec<ScrapedItem>,
    upgrades: Vec<ScrapedUpgrade>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedShip {
    ship_name: String,
    manufacturer: String,
    manufacturer_code: Option<String>,
    image_url: Option<String>,
    membership_id: Option<String>,
    custom_name: Option<String>,
    is_nameable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedItem {
    title: String,
    kind: Option<String>,
    image_url: Option<String>,
    manufacturer: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedUpgrade {
    applied_at: Option<String>,
    ccu_id: Option<String>,
    from_ship_name: String,
    to_ship_name: String,
    new_pledge_value: Option<f64>,
}

/* ─────────────────────────────  Navigation  ──────────────────────────────── */

// Script de poll : retourne l'outerHTML dès que la liste (ou l'état vide) apparaît,
// sinon "PENDING" ; "ERROR:<msg>" si exception (avalée sur Windows sinon).
const POLL_SCRIPT: &str = r#"(function(){
  try {
    var list = document.querySelector('.content-wrapper.content-block1.pledges ul.list-items');
    var empty = document.querySelector('.empy-list');
    if (list || empty) return document.documentElement.outerHTML;
    return 'PENDING';
  } catch(e){ return 'ERROR:' + e.message; }
})()"#;

/// Évalue un JS dans la webview et déballe le résultat (eval_with_callback renvoie
/// la valeur sérialisée en JSON). Exécuté dans un thread bloquant : sur Windows
/// WebView2, eval_with_callback interbloque s'il tourne sur le thread principal.
async fn eval_js(win: tauri::WebviewWindow, js: &'static str) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel::<String>();
        win.eval_with_callback(js, move |v| {
            let _ = tx.send(v);
        })
        .map_err(|e| e.to_string())?;
        let raw = rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "eval timeout".to_string())?;
        Ok(serde_json::from_str::<String>(&raw).unwrap_or(raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Navigue la fenêtre rsi-login vers la page de pledges donnée, puis poll
/// l'apparition de la liste hydratée et renvoie l'outerHTML.
///
/// Contournement Cloudflare (repris de la logique V1 — évite le refresh manuel) :
/// on attend patiemment (jusqu'à 120 s) que la liste s'hydrate, et si la page reste
/// bloquée (challenge « Just a moment » / Access Denied), on **recharge** la page
/// toutes les ~20 s. La fenêtre étant visible, l'utilisateur peut aussi résoudre le
/// challenge ; dès que le conteneur pledges apparaît, on extrait et on continue.
async fn navigate_rsi_page(app: &AppHandle, page: u32) -> Result<String, String> {
    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre RSI fermée".to_string())?;

    let url_str = format!("{PLEDGES_BASE}?page={page}");
    let url = tauri::Url::parse(&url_str).map_err(|e| e.to_string())?;
    win.navigate(url.clone()).map_err(|e| e.to_string())?;

    let start = Instant::now();
    let mut last_reload = Instant::now();
    let mut last_error = String::new();
    while start.elapsed() < Duration::from_secs(120) {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let res = eval_js(win.clone(), POLL_SCRIPT).await?;
        if res == "PENDING" {
            // Bloqué (chargement long / Cloudflare) → reload périodique « auto-refresh ».
            if last_reload.elapsed() >= Duration::from_secs(20) {
                let _ = win.navigate(url.clone());
                last_reload = Instant::now();
            }
            continue;
        }
        if res.starts_with("ERROR") {
            last_error = res;
            if last_reload.elapsed() >= Duration::from_secs(20) {
                let _ = win.navigate(url.clone());
                last_reload = Instant::now();
            }
            continue;
        }
        return Ok(res);
    }

    if last_error.is_empty() {
        Err(format!(
            "Timeout 120s — page {page} non chargée (challenge Cloudflare non résolu ?)"
        ))
    } else {
        Err(format!("Erreur JS page {page} : {last_error}"))
    }
}

/* ──────────────────────────────  Helpers parsing  ─────────────────────────── */

/// Première occurrence d'un sélecteur → valeur d'attribut, trim, non vide.
fn first_attr(el: ElementRef, sel: &Selector, attr: &str) -> Option<String> {
    el.select(sel)
        .next()
        .and_then(|e| e.value().attr(attr))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Première occurrence d'un sélecteur → texte concaténé, trim, non vide.
fn first_text(el: ElementRef, sel: &Selector) -> Option<String> {
    el.select(sel)
        .next()
        .map(|e| e.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Extrait l'URL d'un `background-image: url(...)`. Préfixe l'origine RSI si relatif.
fn bg_url(style: &str, re_bg: &Regex) -> Option<String> {
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
fn strip_paren_suffix(s: &str, re_paren: &Regex) -> String {
    re_paren.replace(s, "").trim().to_string()
}

#[derive(Clone)]
struct NameableShip {
    membership_id: String,
    custom_name: Option<String>,
}

/// Parse le `<script class="js-pledge-nameable-ships">` (array JSON) → map par default_name.
fn parse_nameable(json_text: &str) -> HashMap<String, NameableShip> {
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

fn parse_pledge_html(html: &str) -> Vec<ScrapedPledge> {
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

/* ──────────────────────────────  Commande exposée  ────────────────────────── */

#[tauri::command]
pub async fn scrape_rsi_hangar(app: AppHandle) -> Result<Vec<Value>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut all: Vec<ScrapedPledge> = Vec::new();

    for page in 1..=MAX_PAGES {
        let html = navigate_rsi_page(&app, page).await?;

        // Fin : hangar vide / dernière page.
        if html.contains("empy-list") {
            break;
        }

        let pledges = parse_pledge_html(&html);
        if pledges.is_empty() {
            break;
        }

        // Dédup : si toutes les cartes sont déjà vues, RSI a re-servi une page → stop.
        let fresh: Vec<ScrapedPledge> = pledges
            .into_iter()
            .filter(|p| !seen.contains(&p.rsi_pledge_id))
            .collect();
        if fresh.is_empty() {
            break;
        }
        for p in fresh {
            seen.insert(p.rsi_pledge_id.clone());
            all.push(p);
        }
    }

    all.iter()
        .map(|p| serde_json::to_value(p).map_err(|e| e.to_string()))
        .collect()
}
