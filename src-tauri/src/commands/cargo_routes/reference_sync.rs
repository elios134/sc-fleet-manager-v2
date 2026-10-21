// Synchro des données de référence Cargo (Trade Tools, SC Wiki, positions, mapping des lieux).
use super::*;

/* ────────────────────────  Cores : Trade Tools  ───────────────────────────── */

/// /api/commodity/items → CargoCommodity (clear-then-recreate). Renvoie le nb de lignes.
pub(crate) async fn sync_commodities_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/commodity/items");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse commodity/items inattendue (pas un tableau)")?;
    let names: Vec<String> = arr
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoCommodity").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for name in &names {
        sqlx::query("INSERT OR REPLACE INTO CargoCommodity (name, lastSyncedAt) VALUES (?, datetime('now'))")
            .bind(name)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/// /api/commodity/shops → CargoShop (clear-then-recreate). Stocke leaf + système dérivés.
pub(crate) async fn sync_shops_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/commodity/shops");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse commodity/shops inattendue (pas un tableau)")?;
    struct ShopRow {
        name: String,
        leaf: String,
        system: Option<String>,
    }
    let rows: Vec<ShopRow> = arr
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .map(|name| {
            let leaf = leaf_of(&name);
            let system = system_of(&name);
            ShopRow { name, leaf, system }
        })
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoShop").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO CargoShop (name, leaf, systemName, lastSyncedAt)
             VALUES (?, ?, ?, datetime('now'))",
        )
        .bind(&r.name)
        .bind(&r.leaf)
        .bind(&r.system)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/// /api/ships → CargoShipApi (clear-then-recreate). {name, maxBoxSizeInScu}.
pub(crate) async fn sync_ships_api_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    let url = format!("{TRADE_BASE}/api/ships");
    let json = get_json(client, &url).await?;
    let arr = json.as_array().ok_or("réponse ships inattendue (pas un tableau)")?;
    struct ShipRow {
        name: String,
        max_box: Option<i64>,
    }
    let rows: Vec<ShipRow> = arr
        .iter()
        .filter_map(|it| {
            let name = it.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string())?;
            if name.is_empty() {
                return None;
            }
            let max_box = it.get("maxBoxSizeInScu").and_then(|v| v.as_i64());
            Some(ShipRow { name, max_box })
        })
        .collect();

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoShipApi").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO CargoShipApi (name, maxBoxSizeInScu, lastSyncedAt)
             VALUES (?, ?, datetime('now'))",
        )
        .bind(&r.name)
        .bind(r.max_box)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/* ────────────────────────────  Cores : SC Wiki  ───────────────────────────── */

/// /api/locations (paginé ?page[number]=) → WikiStarmapLocation (clear-then-recreate).
pub(crate) async fn sync_wiki_locations_core(app: &AppHandle, client: &reqwest::Client) -> Result<i64, String> {
    struct LocRow {
        uuid: String,
        slug: Option<String>,
        name: Option<String>,
        designation: Option<String>,
        type_class: Option<String>,
        parent_name: Option<String>,
        parent_slug: Option<String>,
        system: Option<String>,
    }

    let mut rows: Vec<LocRow> = Vec::new();
    let mut page = 1u32;
    let mut last_page = 1u32;
    loop {
        // Brackets encodés (%5B/%5D) pour ne pas dépendre du parsing d'URL.
        let url = format!("{WIKI_BASE}/api/locations?page%5Bnumber%5D={page}");
        let json = get_json(client, &url).await?;
        if let Some(lp) = json
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|x| x.as_u64())
        {
            last_page = lp as u32;
        }
        if let Some(arr) = json.get("data").and_then(|d| d.as_array()) {
            for it in arr {
                let Some(uuid) = it.get("uuid").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                    continue;
                };
                let s = |k: &str| it.get(k).and_then(|v| v.as_str()).map(|x| x.to_string());
                let parent = it.get("parent");
                let parent_name = parent.and_then(|p| p.get("name")).and_then(|v| v.as_str()).map(|x| x.to_string());
                let parent_slug = parent.and_then(|p| p.get("slug")).and_then(|v| v.as_str()).map(|x| x.to_string());
                // `type` est un objet {name, classification, ...} ; `system` est une chaîne.
                let type_class = it
                    .get("type")
                    .and_then(|t| t.get("classification").or_else(|| t.get("name")))
                    .and_then(|v| v.as_str())
                    .map(|x| x.to_string());
                rows.push(LocRow {
                    uuid,
                    slug: s("slug"),
                    name: s("name"),
                    designation: s("designation"),
                    type_class,
                    parent_name,
                    parent_slug,
                    system: s("system"),
                });
            }
        }
        if page >= last_page {
            break;
        }
        page += 1;
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiStarmapLocation").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut n = 0i64;
    for r in &rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiStarmapLocation
               (uuid, slug, name, designation, typeClassification, parentName, parentSlug, systemName, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&r.uuid)
        .bind(&r.slug)
        .bind(&r.name)
        .bind(&r.designation)
        .bind(&r.type_class)
        .bind(&r.parent_name)
        .bind(&r.parent_slug)
        .bind(&r.system)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n)
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PositionsSyncResult {
    pub positions: i64,
    pub connections: i64,
}

/// /api/locations/positions (NON documenté) → WikiLocationPosition + WikiJumpConnection.
/// ISOLÉ : ne touche la DB qu'APRÈS un fetch+parse réussi. Si l'appel échoue, on
/// renvoie Err AVANT tout DELETE → les positions existantes restent intactes.
pub(crate) async fn sync_positions_core(app: &AppHandle, client: &reqwest::Client) -> Result<PositionsSyncResult, String> {
    let url = format!("{WIKI_BASE}/api/locations/positions");
    let json = get_json(client, &url).await?;

    struct PosRow {
        uuid: String,
        name: Option<String>,
        type_: Option<String>,
        system: Option<String>,
        parent_uuid: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        z: Option<f64>,
        qt_valid: bool,
        hidden: bool,
    }
    let data = json.get("data").and_then(|d| d.as_array()).ok_or("positions: champ 'data' absent/invalide")?;
    let mut pos_rows: Vec<PosRow> = Vec::new();
    for it in data {
        let Some(uuid) = it.get("uuid").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
            continue;
        };
        let s = |k: &str| it.get(k).and_then(|v| v.as_str()).map(|x| x.to_string());
        let f = |k: &str| it.get(k).and_then(|v| v.as_f64());
        pos_rows.push(PosRow {
            uuid,
            name: s("name"),
            type_: s("type"),
            system: s("system"),
            parent_uuid: s("parent_uuid"),
            x: f("x"),
            y: f("y"),
            z: f("z"),
            qt_valid: it.get("qt_valid").and_then(|v| v.as_bool()).unwrap_or(false),
            hidden: it.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false),
        });
    }

    struct ConnRow {
        entry: String,
        exit: String,
        entry_sys: Option<String>,
        exit_sys: Option<String>,
        fuel: Option<f64>,
    }
    let mut conn_rows: Vec<ConnRow> = Vec::new();
    if let Some(conns) = json.get("connections").and_then(|c| c.as_array()) {
        for it in conns {
            let entry = it.get("entry_uuid").and_then(|v| v.as_str()).map(|s| s.to_string());
            let exit = it.get("exit_uuid").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let (Some(entry), Some(exit)) = (entry, exit) {
                conn_rows.push(ConnRow {
                    entry,
                    exit,
                    entry_sys: it.get("entry_system").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    exit_sys: it.get("exit_system").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    fuel: it.get("fuel_cost").and_then(|v| v.as_f64()),
                });
            }
        }
    }

    // Garde-fou : un payload soudain vide ne doit pas écraser un cache valide.
    if pos_rows.is_empty() {
        return Err("positions: 0 entité retournée (payload vide) — cache conservé".into());
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiLocationPosition").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM WikiJumpConnection").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    let mut res = PositionsSyncResult::default();
    for r in &pos_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiLocationPosition
               (uuid, name, type, systemName, parentUuid, x, y, z, qtValid, hidden, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&r.uuid)
        .bind(&r.name)
        .bind(&r.type_)
        .bind(&r.system)
        .bind(&r.parent_uuid)
        .bind(r.x)
        .bind(r.y)
        .bind(r.z)
        .bind(i64::from(r.qt_valid))
        .bind(i64::from(r.hidden))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        res.positions += 1;
    }
    for c in &conn_rows {
        sqlx::query(
            "INSERT OR REPLACE INTO WikiJumpConnection
               (entryUuid, exitUuid, entrySystem, exitSystem, fuelCost, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&c.entry)
        .bind(&c.exit)
        .bind(&c.entry_sys)
        .bind(&c.exit_sys)
        .bind(c.fuel)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        res.connections += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(res)
}

/* ────────────────────────────  Mapping lieux  ─────────────────────────────── */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MappingResult {
    pub total: i64,
    pub matched: i64,
    pub unmatched: i64,
    pub via_alias: i64,
}

/// Construit CargoLocationMapping depuis CargoShop (leaf → slug) ↔ WikiStarmapLocation (slug).
/// Consulte CargoLocationAlias d'abord. Les non-résolus (matchType='none') sont logués.
pub(crate) async fn sync_mapping_core(app: &AppHandle) -> Result<MappingResult, String> {
    use std::collections::HashMap;

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);

    // Index Wiki : slug → (uuid, name, system).
    let wiki = sqlx::query("SELECT uuid, slug, name, systemName FROM WikiStarmapLocation WHERE slug IS NOT NULL")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut by_slug: HashMap<String, (String, Option<String>, Option<String>)> = HashMap::new();
    for r in &wiki {
        let slug: String = r.try_get("slug").unwrap_or_default();
        if slug.is_empty() {
            continue;
        }
        let uuid: String = r.try_get("uuid").unwrap_or_default();
        let name: Option<String> = r.try_get::<Option<String>, _>("name").ok().flatten();
        let system: Option<String> = r.try_get::<Option<String>, _>("systemName").ok().flatten();
        by_slug.entry(slug).or_insert((uuid, name, system));
    }

    // Alias manuels : tradeSlug → wikiSlug.
    let alias_rows = sqlx::query("SELECT tradeSlug, wikiSlug FROM CargoLocationAlias")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut alias: HashMap<String, String> = HashMap::new();
    for r in &alias_rows {
        let t: String = r.try_get("tradeSlug").unwrap_or_default();
        let w: String = r.try_get("wikiSlug").unwrap_or_default();
        if !t.is_empty() && !w.is_empty() {
            alias.insert(t, w);
        }
    }

    // Lieux Trade Tools = leaves distinctes des boutiques.
    let shops = sqlx::query("SELECT name, leaf FROM CargoShop")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    // tradeSlug → (leaf example, path example)
    let mut trade: HashMap<String, (String, String)> = HashMap::new();
    for r in &shops {
        let name: String = r.try_get("name").unwrap_or_default();
        let leaf: String = r.try_get("leaf").unwrap_or_default();
        if leaf.is_empty() {
            continue;
        }
        let slug = slugify(&leaf);
        if slug.is_empty() {
            continue;
        }
        trade.entry(slug).or_insert((leaf, name));
    }

    let mut res = MappingResult::default();
    let mut unmatched_log: Vec<String> = Vec::new();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM CargoLocationMapping").execute(&mut *tx).await.map_err(|e| e.to_string())?;

    for (trade_slug, (leaf, path)) in &trade {
        res.total += 1;
        // alias d'abord, sinon match direct sur le slug.
        let (match_type, wiki_slug_used, via_alias) = match alias.get(trade_slug) {
            Some(target) => ("alias", target.clone(), true),
            None => ("slug", trade_slug.clone(), false),
        };
        let hit = by_slug.get(&wiki_slug_used);

        let (m_type, uuid, w_slug, w_name, w_sys) = match hit {
            Some((uuid, name, system)) => {
                res.matched += 1;
                if via_alias {
                    res.via_alias += 1;
                }
                (match_type, Some(uuid.clone()), Some(wiki_slug_used.clone()), name.clone(), system.clone())
            }
            None => {
                res.unmatched += 1;
                unmatched_log.push(format!("{trade_slug} (\"{leaf}\")"));
                ("none", None, None, None, None)
            }
        };

        sqlx::query(
            "INSERT OR REPLACE INTO CargoLocationMapping
               (tradeSlug, tradeLeaf, tradeExamplePath, wikiUuid, wikiSlug, wikiName, wikiSystem, matchType, lastSyncedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(trade_slug)
        .bind(leaf)
        .bind(path)
        .bind(&uuid)
        .bind(&w_slug)
        .bind(&w_name)
        .bind(&w_sys)
        .bind(m_type)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    if !unmatched_log.is_empty() {
        eprintln!(
            "[cargo_routes] mapping NON résolus ({}) — à traiter via CargoLocationAlias : {}",
            unmatched_log.len(),
            unmatched_log.join(", ")
        );
    }
    Ok(res)
}

/// Contrôle de cohérence : combien des 14 hubs d'audit sont résolus bout-en-bout
/// (slug présent en WikiStarmapLocation ET position x/y/z disponible).
pub(crate) async fn check_audit_hubs(app: &AppHandle) -> Result<i64, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let pool: &Pool<Sqlite> = pool_from!(lock);
    let mut ok = 0i64;
    for slug in AUDIT_HUB_SLUGS {
        let row = sqlx::query(
            "SELECT 1
               FROM WikiStarmapLocation l
               JOIN WikiLocationPosition p ON p.uuid = l.uuid
              WHERE l.slug = ?
              LIMIT 1",
        )
        .bind(slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
        if row.is_some() {
            ok += 1;
        } else {
            eprintln!("[cargo_routes] hub d'audit NON résolu (slug+position) : {slug}");
        }
    }
    Ok(ok)
}
