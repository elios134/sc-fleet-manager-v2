#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use tauri_plugin_sql::{Migration, MigrationKind};

/// URL de la base SQLite, partagée par le plugin SQL (preload + migrations) et
/// par TOUTES les commandes (`db_instances.get(DB_URL)`). Le pool est keyé sur
/// cette chaîne exacte : elle doit être identique au `preload` de la config.
///
/// En build DEBUG (`npm run tauri dev`) on isole la base de DEV pour ne pas
/// polluer la base de l'app INSTALLÉE (même identifier AppData
/// `com.andre.sc-fleet-manager-v2`). L'overlay `tauri.dev.conf.json` fait
/// pointer le `preload` sur le même fichier `scfleet-dev.db`.
///
/// En RELEASE : strictement `"sqlite:scfleet.db"` → chemin AppData inchangé,
/// aucune incidence pour les utilisateurs existants.
#[cfg(debug_assertions)]
pub const DB_URL: &str = "sqlite:scfleet-dev.db";
#[cfg(not(debug_assertions))]
pub const DB_URL: &str = "sqlite:scfleet.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {    let migrations = vec![
        Migration { version: 1, description: "init", sql: include_str!("../migrations/0001_init.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "ship", sql: include_str!("../migrations/0002_ship.sql"), kind: MigrationKind::Up },
        Migration { version: 3, description: "loadout", sql: include_str!("../migrations/0003_loadout.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "ccu", sql: include_str!("../migrations/0004_ccu.sql"), kind: MigrationKind::Up },
        Migration { version: 5, description: "pledges", sql: include_str!("../migrations/0005_pledges.sql"), kind: MigrationKind::Up },
        Migration { version: 6, description: "missions", sql: include_str!("../migrations/0006_missions.sql"), kind: MigrationKind::Up },
        Migration { version: 7, description: "blueprints", sql: include_str!("../migrations/0007_blueprints.sql"), kind: MigrationKind::Up },
        Migration { version: 8, description: "settings", sql: include_str!("../migrations/0008_settings.sql"), kind: MigrationKind::Up },
        Migration { version: 9, description: "scopes_seed", sql: include_str!("../migrations/0009_scopes_seed.sql"), kind: MigrationKind::Up },
        Migration { version: 10, description: "notifications", sql: include_str!("../migrations/0010_notifications.sql"), kind: MigrationKind::Up },
        Migration { version: 11, description: "blueprint_slots", sql: include_str!("../migrations/0011_blueprint_slots.sql"), kind: MigrationKind::Up },
        Migration { version: 12, description: "blueprint_item_meta", sql: include_str!("../migrations/0012_blueprint_item_meta.sql"), kind: MigrationKind::Up },
        Migration { version: 13, description: "blueprint_description_data", sql: include_str!("../migrations/0013_blueprint_description_data.sql"), kind: MigrationKind::Up },
        Migration { version: 14, description: "cargo_reference", sql: include_str!("../migrations/0014_cargo_reference.sql"), kind: MigrationKind::Up },
        Migration { version: 15, description: "cargo_prices", sql: include_str!("../migrations/0015_cargo_prices.sql"), kind: MigrationKind::Up },
        Migration { version: 16, description: "cargo_alias_typo", sql: include_str!("../migrations/0016_cargo_alias_typo.sql"), kind: MigrationKind::Up },
        Migration { version: 17, description: "component_qt_accel", sql: include_str!("../migrations/0017_component_qt_accel.sql"), kind: MigrationKind::Up },
        Migration { version: 18, description: "uex_prices", sql: include_str!("../migrations/0018_uex_prices.sql"), kind: MigrationKind::Up },
        Migration { version: 19, description: "drop_cargo_price_listing", sql: include_str!("../migrations/0019_drop_cargo_price_listing.sql"), kind: MigrationKind::Up },
        Migration { version: 20, description: "ship_acquisition", sql: include_str!("../migrations/0020_ship_acquisition.sql"), kind: MigrationKind::Up },
        Migration { version: 21, description: "starmap_wiki", sql: include_str!("../migrations/0021_starmap_wiki.sql"), kind: MigrationKind::Up },
        Migration { version: 22, description: "item_catalog", sql: include_str!("../migrations/0022_item_catalog.sql"), kind: MigrationKind::Up },
        Migration { version: 23, description: "loadout_hierarchy", sql: include_str!("../migrations/0023_loadout_hierarchy.sql"), kind: MigrationKind::Up },
        Migration { version: 24, description: "loadout_turret_type", sql: include_str!("../migrations/0024_loadout_turret_type.sql"), kind: MigrationKind::Up },
        Migration { version: 25, description: "acquisition_indexes", sql: include_str!("../migrations/0025_acquisition_indexes.sql"), kind: MigrationKind::Up },
        Migration { version: 26, description: "shiphardpoint_default_index", sql: include_str!("../migrations/0026_shiphardpoint_default_index.sql"), kind: MigrationKind::Up },
        Migration { version: 27, description: "component_qt_fuel_per_gm", sql: include_str!("../migrations/0027_component_qt_fuel_per_gm.sql"), kind: MigrationKind::Up },
        Migration { version: 28, description: "rsi_news", sql: include_str!("../migrations/0028_rsi_news.sql"), kind: MigrationKind::Up },
        Migration { version: 29, description: "gamelog", sql: include_str!("../migrations/0029_gamelog.sql"), kind: MigrationKind::Up },
        Migration { version: 30, description: "trade_journal", sql: include_str!("../migrations/0030_trade_journal.sql"), kind: MigrationKind::Up },
        Migration { version: 31, description: "starmap_rsi", sql: include_str!("../migrations/0031_starmap_rsi.sql"), kind: MigrationKind::Up },
        Migration { version: 32, description: "rsi_news_image", sql: include_str!("../migrations/0032_rsi_news_image.sql"), kind: MigrationKind::Up },

    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Lancement auto (login item OS). Pas d'arguments forcés au boot ; le toggle
        // UI (enable/disable/isEnabled) arrive au Lot E.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // MAJ auto (vérifie le manifeste latest.json signé sur les GitHub Releases).
        // L'UI de vérification arrive à l'Étape 3 ; ici on installe/configure seulement.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // relaunch() après installation d'une MAJ (UI Étape 3).
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DB_URL, migrations)
                .build()
        )
        .setup(|app| {
            // Surveillance « app ouverte » : déclencheurs assurance (check au lancement
            // puis toutes les 30 min). S'arrête avec le process.
            commands::notifications::spawn_monitor(app.handle().clone());

            // Lecteur Game.log (Phase 1) : tâche de fond qui tail le log SC quand activé
            // (opt-in via AppMeta gamelog.enabled). 100 % local, lecture seule.
            commands::gamelog::spawn_gamelog_watcher(app.handle().clone());

            // Carte stellaire (sous-projet A) : rafraîchit StarmapBody depuis l'API RSI au
            // lancement si périmé (>7 j), re-check 24 h. Repli Wiki si RSI échoue. Best-effort.
            commands::datamining::spawn_starmap_sync(app.handle().clone());

            // Overlay en jeu (Phase 2) : raccourci GLOBAL F6 via hook clavier bas niveau
            // (Windows) — fonctionne même quand Star Citizen a le focus.
            commands::overlay::spawn_overlay_hotkey(app.handle().clone());

            // ── Tray système (close-to-tray, parité V1) ──
            // Icône d'app + menu Ouvrir/Quitter ; clic gauche = ouvrir, clic droit = menu.
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let open_i = MenuItemBuilder::with_id("open", "Ouvrir SC Fleet Manager").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quitter").build(app)?;
            let menu = MenuBuilder::new(app).item(&open_i).separator().item(&quit_i).build()?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("SC Fleet Manager")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            // Réutilise l'icône d'app bundlée (pas de nouvel asset).
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fleet::get_ships,
            commands::fleet::get_fleet_stats,
            commands::fleet::sync_fleet_from_scrape,
            commands::fleet::get_hangar_items,
            commands::fleet::get_ship_pledge_origin,
            commands::fleet::get_fleet_packs,
            commands::fleet::get_pack_detail,
            commands::fleet::add_fleet_ship,
            commands::fleet::delete_fleet_ship,
            commands::fleet::extend_ship_rental,
            commands::dev::seed_sample_pack,
            commands::dev::remove_sample_pack,
            commands::insurance::get_insurance_ships,
            commands::insurance::renew_insurance,
            commands::account::get_accounts,
            commands::account::get_active_account_id,
            commands::account::set_active_account,
            commands::account::create_account,
            commands::account::update_account,
            commands::settings::delete_account,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::settings::get_notification_settings,
            commands::settings::update_notification_setting,
            commands::settings::get_pinned_nav,
            commands::settings::set_pinned_nav,
            commands::settings::get_app_meta,
            commands::settings::set_app_meta,
            commands::dashboard::get_dashboard_data,
            commands::ccu_chain::get_ccu_catalog_status,
            commands::ccu_chain::get_ccu_ships_metadata,
            commands::ccu_chain::find_ccu_paths,
            commands::ccu_chain::sync_ccu_catalog,
            commands::ccu_chain::cancel_ccu_sync,
            commands::notifications::create_notification,
            commands::notifications::send_test_notification,
            commands::notifications::list_notifications,
            commands::notifications::unread_count,
            commands::notifications::mark_notification_read,
            commands::notifications::mark_all_read,
            commands::notifications::delete_notification,
            commands::notifications::delete_all_notifications,
            commands::patch_detect::get_patch_status,
            commands::missions::list_missions,
            commands::missions::get_mission_blueprints,
            commands::missions::get_distinct_factions,
            commands::missions::get_missions_status,
            commands::missions::list_objectives,
            commands::missions::toggle_objective,
            commands::missions::list_favorites,
            commands::missions::toggle_favorite,
            commands::missions::update_favorite_note,
            commands::missions::get_scopes,
            commands::missions::get_scope_progress,
            commands::missions::set_scope_progress,
            commands::crafting_hub::list_blueprints,
            commands::crafting_hub::get_crafting_stats,
            commands::crafting_hub::get_blueprint_detail,
            commands::crafting_hub::list_blueprint_owned,
            commands::crafting_hub::toggle_blueprint_owned,
            commands::crafting_hub::resync_blueprints_from_log,
            commands::crafting_hub::set_blueprint_log_alias,
            commands::crafting_hub::get_ingredient_mining_locations,
            commands::comparator::get_all_ship_data,
            commands::loadout::get_fleet_ships_for_loadout,
            commands::loadout::get_loadouts_by_ship,
            commands::loadout::get_ship_hardpoints,
            commands::loadout::get_stock_for_ship,
            commands::loadout::get_components_by_type,
            commands::loadout::get_components_for_slot,
            commands::loadout::get_acquisition_detail,
            commands::loadout::save_loadout,
            commands::loadout::delete_loadout,
            commands::auth::check_rsi_login_status,
            commands::auth::extract_and_store_rsi_session,
            commands::auth::extract_rsi_handle,
            commands::auth::get_rsi_session_status,
            commands::auth::logout_rsi,
            commands::auth::reload_rsi_login,
            commands::auth::purge_rsi_cookies,
            commands::auth::inject_rsi_cookies,
            commands::rsi_scrape::scrape_rsi_hangar,
            commands::rsi_scrape::scrape_rsi_concierge,
            commands::wiki_sync::sync_ship_data,
            commands::wiki_sync::sync_components,
            commands::wiki_sync::sync_missions,
            commands::wiki_sync::sync_blueprints,
            commands::starjump::get_starjump_ships,
            commands::datamining::enrich_blueprint_stats,
            commands::datamining::backfill_blueprint_names_fr,
            commands::datamining::sync_mining_locations,
            commands::datamining::sync_starmap,
            commands::datamining::sync_starmap_from_wiki,
            commands::datamining::starmap_rsi::sync_starmap_from_rsi,
            commands::datamining::get_starmap_bodies,
            commands::datamining::get_starmap_body_image,
            commands::datamining_extract::start_extraction,
            commands::datamining_extract::cancel_extraction,
            commands::datamining_extract::get_extraction_status,
            commands::datamining_extract::validate_sc_path,
            commands::datamining_extract::set_sc_install_path,
            commands::datamining_extract::get_sc_install_path,
            commands::cargo_routes::sync_cargo_reference,
            commands::cargo_routes::sync_cargo_positions,
            commands::cargo_routes::get_cargo_reference_status,
            commands::cargo_routes::find_cargo_routes,
            commands::cargo_routes::find_cargo_routes_demo,
            commands::cargo_routes::find_cargo_loop,
            commands::cargo_routes::get_trade_graph,
            commands::cargo_routes::get_cargo_commodities,
            commands::cargo_routes::get_dashboard_top_routes,
            commands::cargo_routes::get_cargo_fleet_ships,
            commands::cargo_routes::get_cargo_catalog_ships,
            commands::cargo_routes::get_location_hierarchy,
            commands::uex::sync_uex_prices,
            commands::uex::get_uex_prices_status,
            commands::uex::get_mining_loadout,
            commands::uex::get_salvage_loadout,
            commands::hangar_exec::get_hangar_exec_status,
            commands::hangar_exec::get_hangar_exec_timers,
            commands::hangar_exec::start_hangar_exec_timer,
            commands::cargo_grid::get_cargo_grid,
            commands::catalog::sync_item_catalog,
            commands::catalog::sync_vehicle_marketplace,
            commands::catalog::get_item_categories,
            commands::catalog::get_catalog_items,
            commands::catalog::get_item_purchase_points,
            commands::catalog::get_catalog_vehicles,
            commands::catalog::get_vehicle_marketplace,
            commands::catalog::get_item_wiki_detail,
            commands::news::get_rsi_news,
            commands::rsi_status::get_rsi_server_status,
            commands::gamelog::get_gamelog_status,
            commands::gamelog::set_gamelog_enabled,
            commands::gamelog::replay_gamelog,
            commands::gamelog::get_current_location,
            commands::gamelog::get_recent_gamelog_events,
            commands::gamelog::get_journal_stats,
            commands::trade_journal::add_trade_journal_entry,
            commands::trade_journal::list_trade_journal,
            commands::trade_journal::delete_trade_journal_entry,
            commands::trade_journal::get_trade_journal_stats,
            commands::overlay::toggle_overlay,
            commands::overlay::hide_overlay,
        ])
        // Close-to-tray (parité V1) : la croix de la fenêtre main masque au lieu de
        // quitter. Le vrai quit passe par le menu tray « Quitter » (app.exit), qui
        // ne déclenche pas CloseRequested → pas de flag isQuitting nécessaire.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}