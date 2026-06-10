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
        ])        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}