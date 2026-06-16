// Shim CLI Tauri — DEV UNIQUEMENT.
//
// But : faire en sorte que `npm run tauri dev` isole la base de données de dev
// (scfleet-dev.db) pour ne pas polluer la base de l'app INSTALLÉE, qui partage
// le même dossier AppData (même identifier `com.andre.sc-fleet-manager-v2`).
//
// Le pool SQLite est créé par le plugin à partir du `preload` de la config.
// On applique donc un overlay (`src-tauri/tauri.dev.conf.json`) qui fait pointer
// le preload sur `sqlite:scfleet-dev.db` — mais SEULEMENT pour la sous-commande
// `dev`. Pour `build` (release) : AUCUN overlay → la config lue est exactement
// `tauri.conf.json` d'origine (preload `sqlite:scfleet.db`, identifier, updater
// inchangés). Le binaire release compile par ailleurs l'arm
// `cfg(not(debug_assertions))` => DB_URL == "sqlite:scfleet.db".
//
// Conséquence : `npm run tauri build` se comporte exactement comme avant ce
// correctif ; rien dans le chemin release n'est modifié.

import cli from '@tauri-apps/cli'

const args = process.argv.slice(2)

if (args[0] === 'dev') {
  args.push('--config', 'src-tauri/tauri.dev.conf.json')
}

cli.run(args, 'tauri').catch((err) => {
  console.error(err)
  process.exitCode = 1
})
