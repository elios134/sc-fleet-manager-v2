// Phase 0 — Actualités RSI (flux comm-link officiel).
//
// Récupère le flux RSS public de RSI (https://robertsspaceindustries.com/comm-link/rss),
// le parse en RSS 2.0 (regex — pas de nouvelle dépendance XML), met en cache en base
// (table RsiNews) et renvoie les N dernières entrées. Tolérant aux pannes :
//  - cache encore frais (TTL) → renvoie le cache sans réseau ;
//  - fetch OK → met à jour le cache + renvoie le flux fraîchement parsé ;
//  - fetch KO → renvoie le dernier cache disponible (consultable hors-ligne).
//
// 100 % donnée publique RSI. Aucune authentification.

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

// Le flux RSS comm-link a été supprimé (refonte du site RSI) → on scrape la page HTML.
const COMMLINK_URL: &str = "https://robertsspaceindustries.com/en/comm-link";
// User-Agent navigateur : RSI (Cloudflare) rejette les UA non navigateur.
const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CACHE_TTL_SECS: i64 = 30 * 60; // 30 min : on ne re-télécharge pas plus souvent
const MAX_ITEMS: i64 = 20;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub link: String,
    pub pub_date: Option<String>,
    pub category: Option<String>,
    pub summary: Option<String>,
    pub image: Option<String>,
}

/* ─────────────────────────── Scraping page comm-link ───────────────────────── */

/// Décode les entités HTML les plus courantes.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

/// Catégorie comm-link lisible (segment d'URL → libellé).
fn pretty_category(cat: &str) -> String {
    match cat {
        "transmission" => "Transmission".to_string(),
        "spectrum-dispatch" => "Spectrum Dispatch".to_string(),
        "engineering" => "Engineering".to_string(),
        "physical-goods" => "Goodies".to_string(),
        other => other.replace('-', " "),
    }
}

/// Normalise une URL d'image (relative / protocole-relatif → https absolu). None si
/// vide ou data-URI (placeholders/spinners).
fn norm_img_url(u: &str) -> Option<String> {
    let u = u.trim();
    if u.is_empty() || u.starts_with("data:") {
        return None;
    }
    if u.starts_with("http") {
        Some(u.to_string())
    } else if u.starts_with("//") {
        Some(format!("https:{u}"))
    } else if u.starts_with('/') {
        Some(format!("https://robertsspaceindustries.com{u}"))
    } else {
        None
    }
}

/// Extrait l'URL d'un `background-image: url(...)` d'un attribut style.
fn bg_image_url(style: &str) -> Option<String> {
    let idx = style.to_lowercase().find("url(")?;
    let rest = &style[idx + 4..];
    let end = rest.find(')')?;
    let inner = rest[..end].trim().trim_matches('\'').trim_matches('"');
    norm_img_url(inner)
}

/// Miniature d'un article : premier `<img>` (src/data-src/srcset) ou `background-image`
/// trouvé dans l'élément (ou ses descendants).
fn extract_image(el: scraper::ElementRef) -> Option<String> {
    use scraper::Selector;
    if let Ok(img_sel) = Selector::parse("img") {
        for img in el.select(&img_sel) {
            for attr in ["src", "data-src", "data-lazy-src"] {
                if let Some(found) = img.value().attr(attr).and_then(norm_img_url) {
                    return Some(found);
                }
            }
            if let Some(srcset) = img.value().attr("srcset") {
                if let Some(found) = srcset
                    .split(',')
                    .next()
                    .and_then(|f| f.trim().split_whitespace().next())
                    .and_then(norm_img_url)
                {
                    return Some(found);
                }
            }
        }
    }
    if let Some(found) = el.value().attr("style").and_then(bg_image_url) {
        return Some(found);
    }
    if let Ok(style_sel) = Selector::parse("[style]") {
        for e in el.select(&style_sel) {
            if let Some(found) = e.value().attr("style").and_then(bg_image_url) {
                return Some(found);
            }
        }
    }
    None
}

/// Lien d'article normalisé depuis un href (None si ce n'est pas un article comm-link).
fn article_link(href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    let path = href.trim_start_matches("https://robertsspaceindustries.com");
    let segs: Vec<&str> = path
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let i = segs.iter().position(|s| *s == "comm-link")?;
    if segs.len() < i + 3 {
        return None;
    }
    Some(if href.starts_with("http") {
        href.to_string()
    } else {
        format!("https://robertsspaceindustries.com{href}")
    })
}

/// Scrape la page comm-link : extrait les liens d'articles (`<a href*="/comm-link/…">`)
/// et leur titre. Approche par ancres → robuste aux variations de mise en page.
/// Un article a au moins 3 segments d'URL : /comm-link/<catégorie>/<slug>.
fn parse_commlink(html: &str) -> Vec<NewsItem> {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let sel = match Selector::parse(r#"a[href*="/comm-link/"]"#) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    // 1ʳᵉ passe : miniature par article (l'image et le titre sont parfois dans des
    // ancres distinctes pointant le même article).
    let mut images: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for el in doc.select(&sel) {
        if let Some(link) = el.value().attr("href").and_then(article_link) {
            if let Some(img) = extract_image(el) {
                images.entry(link).or_insert(img);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for el in doc.select(&sel) {
        let href = el.value().attr("href").unwrap_or("").trim();
        if href.is_empty() {
            continue;
        }
        let path = href.trim_start_matches("https://robertsspaceindustries.com");
        let segs: Vec<&str> = path
            .split(['?', '#'])
            .next()
            .unwrap_or("")
            .trim_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();
        // Position de "comm-link" puis exigence d'au moins catégorie + slug derrière.
        let Some(i) = segs.iter().position(|s| *s == "comm-link") else {
            continue;
        };
        if segs.len() < i + 3 {
            continue; // page de catégorie, pas un article
        }
        let title = decode_entities(&el.text().collect::<String>())
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if title.chars().count() < 4 {
            continue; // ancre sans titre exploitable (image, « lire la suite »…)
        }
        let link = if href.starts_with("http") {
            href.to_string()
        } else {
            format!("https://robertsspaceindustries.com{href}")
        };
        if !seen.insert(link.clone()) {
            continue;
        }
        let category = segs.get(i + 1).map(|s| pretty_category(s));
        let image = images.get(&link).cloned();
        out.push(NewsItem {
            title,
            link,
            pub_date: None,
            category,
            summary: None,
            image,
        });
        if out.len() >= MAX_ITEMS as usize {
            break;
        }
    }
    out
}

/* ───────────────────────────────── Cache DB ────────────────────────────────── */

async fn app_meta_get(pool: &SqlitePool, key: &str) -> Option<String> {
    crate::commands::app_meta::get(pool, key).await
}

/// Cache frais ? (dernier fetch < TTL).
async fn cache_is_fresh(pool: &SqlitePool) -> bool {
    let row = sqlx::query(
        "SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) AS age",
    )
    .bind(app_meta_get(pool, "news.lastFetchedAt").await.unwrap_or_default())
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some(r) => r.try_get::<Option<i64>, _>("age").ok().flatten().map(|a| a < CACHE_TTL_SECS).unwrap_or(false),
        None => false,
    }
}

/// Remplace le cache par le flux fraîchement parsé (la `position` conserve l'ordre du flux).
async fn replace_cache(pool: &SqlitePool, items: &[NewsItem]) {
    let _ = sqlx::query("DELETE FROM RsiNews").execute(pool).await;
    for (i, it) in items.iter().enumerate() {
        let _ = sqlx::query(
            "INSERT OR REPLACE INTO RsiNews (guid, title, link, pubDate, category, summary, image, position, fetchedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&it.link) // le lien sert de clé stable
        .bind(&it.title)
        .bind(&it.link)
        .bind(&it.pub_date)
        .bind(&it.category)
        .bind(&it.summary)
        .bind(&it.image)
        .bind(i as i64)
        .execute(pool)
        .await;
    }
    // Marque l'horodatage du dernier fetch réussi (sert au TTL du cache).
    let _ = sqlx::query(
        "INSERT INTO AppMeta (key, value) VALUES ('news.lastFetchedAt', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = datetime('now')",
    )
    .execute(pool)
    .await;
}

/// Lit le cache (ordre du flux conservé).
async fn read_cache(pool: &SqlitePool, limit: i64) -> Vec<NewsItem> {
    let rows = sqlx::query(
        "SELECT title, link, pubDate, category, summary, image
         FROM RsiNews ORDER BY position ASC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.iter()
        .map(|r| NewsItem {
            title: r.try_get::<String, _>("title").unwrap_or_default(),
            link: r.try_get::<String, _>("link").unwrap_or_default(),
            pub_date: r.try_get::<Option<String>, _>("pubDate").ok().flatten(),
            category: r.try_get::<Option<String>, _>("category").ok().flatten(),
            summary: r.try_get::<Option<String>, _>("summary").ok().flatten(),
            image: r.try_get::<Option<String>, _>("image").ok().flatten(),
        })
        .collect()
}

/* ───────────────────────────────── Commande ────────────────────────────────── */

async fn fetch_news() -> Result<Vec<NewsItem>, String> {
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(COMMLINK_URL).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("RSI comm-link {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let items = parse_commlink(&body);
    if items.is_empty() {
        return Err("page comm-link vide ou illisible".into());
    }
    Ok(items)
}

/// Actualités RSI : renvoie au plus `limit` entrées (défaut 8). `force` ignore le TTL cache.
#[tauri::command]
pub async fn get_rsi_news(
    limit: Option<i64>,
    force: Option<bool>,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<NewsItem>, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let limit = limit.unwrap_or(8).clamp(1, MAX_ITEMS);
    let force = force.unwrap_or(false);

    // Cache encore frais → on sert le cache sans toucher au réseau.
    if !force && cache_is_fresh(pool).await {
        return Ok(read_cache(pool, limit).await);
    }

    match fetch_news().await {
        Ok(items) => {
            replace_cache(pool, &items).await;
            Ok(items.into_iter().take(limit as usize).collect())
        }
        // Réseau KO : on retombe sur le cache (consultable hors-ligne).
        Err(_) => Ok(read_cache(pool, limit).await),
    }
}
