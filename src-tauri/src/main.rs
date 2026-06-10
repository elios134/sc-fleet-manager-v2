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

    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:scfleet.db", migrations)
                .build()
        )
        .invoke_handler(tauri::generate_handler![
            commands::fleet::get_ships,
            commands::fleet::get_fleet_stats,
            commands::account::get_accounts,
            commands::account::get_active_account_id,
            commands::account::set_active_account,
            commands::account::create_account,
            commands::settings::delete_account,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::settings::get_notification_settings,
            commands::settings::update_notification_setting,
            commands::dashboard::get_dashboard_data,
            commands::ccu_chain::get_ccu_catalog_status,
            commands::ccu_chain::get_ccu_ships_metadata,
            commands::ccu_chain::find_ccu_paths,
            commands::missions::list_missions,
            commands::missions::get_distinct_factions,
            commands::missions::get_missions_status,
            commands::missions::list_objectives,
            commands::missions::toggle_objective,
            commands::missions::list_favorites,
            commands::missions::toggle_favorite,
            commands::missions::update_favorite_note,
            commands::crafting_hub::list_blueprints,
            commands::crafting_hub::get_crafting_stats,
            commands::crafting_hub::get_blueprint_detail,
            commands::crafting_hub::list_blueprint_owned,
            commands::crafting_hub::toggle_blueprint_owned,
            commands::comparator::get_all_ship_data,
            commands::loadout::get_fleet_ships_for_loadout,
            commands::loadout::get_loadouts_by_ship,
            commands::loadout::get_ship_hardpoints,
            commands::loadout::get_components_by_type,
            commands::loadout::save_loadout,
            commands::loadout::delete_loadout,
            commands::auth::check_rsi_login_status,
            commands::auth::extract_and_store_rsi_session,
            commands::auth::get_rsi_session_status,
            commands::auth::logout_rsi,
            commands::rsi_scrape::scrape_rsi_hangar,
        ])        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}