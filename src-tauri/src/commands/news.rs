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

const RSS_URL: &str = "https://robertsspaceindustries.com/comm-link/rss";
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
}

/* ─────────────────────────────── Parsing RSS ───────────────────────────────── */

/// Enlève une enveloppe CDATA (`<![CDATA[ … ]]>`) si présente.
fn strip_cdata(s: &str) -> String {
    let t = s.trim();
    if let Some(inner) = t.strip_prefix("<![CDATA[").and_then(|x| x.strip_suffix("]]>")) {
        return inner.trim().to_string();
    }
    t.to_string()
}

/// Décode les entités HTML/XML les plus courantes (pas de dépendance dédiée).
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

/// Retire les balises HTML d'un fragment (pour produire un résumé texte).
fn strip_html(s: &str) -> String {
    let re = regex::Regex::new(r"(?s)<[^>]+>").expect("regex html valide");
    let stripped = re.replace_all(s, " ");
    let collapse = regex::Regex::new(r"\s+").expect("regex espaces valide");
    collapse.replace_all(stripped.trim(), " ").to_string()
}

/// Contenu d'une balise simple `<tag …>…</tag>` au sein d'un bloc (CDATA + entités gérés).
fn extract_tag(block: &str, tag: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(r"(?s)<{tag}[^>]*>(.*?)</{tag}>")).ok()?;
    let caps = re.captures(block)?;
    let raw = caps.get(1)?.as_str();
    let cleaned = decode_entities(&strip_cdata(raw));
    let trimmed = cleaned.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Parse les `<item>` d'un flux RSS 2.0 en NewsItem (ordre du flux = anté-chronologique).
fn parse_rss(xml: &str) -> Vec<NewsItem> {
    let item_re = regex::Regex::new(r"(?s)<item[^>]*>(.*?)</item>").expect("regex item valide");
    let mut out = Vec::new();
    for caps in item_re.captures_iter(xml) {
        let block = &caps[1];
        let title = extract_tag(block, "title").unwrap_or_else(|| "—".to_string());
        // Lien : <link> en priorité, sinon <guid> (souvent l'URL permanente).
        let link = extract_tag(block, "link")
            .or_else(|| extract_tag(block, "guid"))
            .unwrap_or_default();
        if link.is_empty() {
            continue; // entrée inexploitable
        }
        let pub_date = extract_tag(block, "pubDate");
        let category = extract_tag(block, "category");
        let summary = extract_tag(block, "description").map(|d| {
            let text = strip_html(&d);
            if text.chars().count() > 240 {
                let truncated: String = text.chars().take(240).collect();
                format!("{}…", truncated.trim_end())
            } else {
                text
            }
        });
        out.push(NewsItem {
            title,
            link,
            pub_date,
            category,
            summary,
        });
    }
    out
}

/* ───────────────────────────────── Cache DB ────────────────────────────────── */

async fn app_meta_get(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
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
            "INSERT OR REPLACE INTO RsiNews (guid, title, link, pubDate, category, summary, position, fetchedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&it.link) // le lien sert de clé stable
        .bind(&it.title)
        .bind(&it.link)
        .bind(&it.pub_date)
        .bind(&it.category)
        .bind(&it.summary)
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
        "SELECT title, link, pubDate, category, summary
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
        })
        .collect()
}

/* ───────────────────────────────── Commande ────────────────────────────────── */

async fn fetch_rss() -> Result<Vec<NewsItem>, String> {
    let client = reqwest::Client::builder()
        .user_agent("SCFleetManager/2.0")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(RSS_URL).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("RSI comm-link {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let items = parse_rss(&body);
    if items.is_empty() {
        return Err("flux RSS vide ou illisible".into());
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

    match fetch_rss().await {
        Ok(items) => {
            replace_cache(pool, &items).await;
            Ok(items.into_iter().take(limit as usize).collect())
        }
        // Réseau KO : on retombe sur le cache (consultable hors-ligne).
        Err(_) => Ok(read_cache(pool, limit).await),
    }
}
