mod commands;

use tauri_plugin_sql::{Migration, MigrationKind};

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
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:scfleet.db", migrations)
                .build()
        )
        .setup(|app| {
            // Surveillance « app ouverte » : déclencheurs assurance (check au lancement
            // puis toutes les 30 min). S'arrête avec le process.
            commands::notifications::spawn_monitor(app.handle().clone());
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
            commands::crafting_hub::get_ingredient_mining_locations,
            commands::comparator::get_all_ship_data,
            commands::loadout::get_fleet_ships_for_loadout,
            commands::loadout::get_loadouts_by_ship,
            commands::loadout::get_ship_hardpoints,
            commands::loadout::get_stock_for_ship,
            commands::loadout::get_components_by_type,
            commands::loadout::get_components_for_slot,
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
            commands::datamining::sync_mining_locations,
            commands::datamining::sync_starmap,
            commands::datamining::get_starmap_bodies,
            commands::datamining::get_starmap_body_image,
            commands::datamining_extract::start_extraction,
            commands::datamining_extract::cancel_extraction,
            commands::datamining_extract::get_extraction_status,
            commands::datamining_extract::validate_sc_path,
            commands::datamining_extract::set_sc_install_path,
            commands::datamining_extract::get_sc_install_path,
        ])        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}