# Synchro automatique (spec)

Validée par André le 14/11/2026 (maquette `docs/design/maquette-synchro-auto.html`, version 3).

## Objectif
Les données de l'appli se tiennent à jour sans clic : prix UEX à chaque lancement, wiki + cargo et
carte à chaque nouvelle mise à jour de Star Citizen installée.

## Ce qui existe déjà (vérifié)
- Synchros par source dans Réglages › Données (`useDataSync` : groupes wiki, cargo, uex ; ordre
  obligatoire wiki → cargo → uex). Date de dernière synchro en AppMeta `sync.lastSync.<source>`.
- `get_patch_status` : changenum installé (`build_manifest.id`) face à la version des données du wiki
  (`*.lastSyncedGameVersion`). Le wiki peut rester en retard de plusieurs jours sur le patch.
- Notification Rust « Nouveau patch SC » au lancement (1 par changenum).
- Pastille du premier lancement (`OnboardingBadge`), alerte Accueil « Nouveau patch ».

## Fonctionnalités
1. **Interrupteur** « Synchronisation automatique » (Réglages › Données), activé par défaut.
   AppMeta `autoSync.enabled` (`"0"` = éteint, sinon allumé). Tuiles : règles, patch installé,
   dernière synchro de patch (AppMeta `autoSync.last` = `{ version, at }`).
2. **Au lancement** (après le premier lancement terminé, interrupteur allumé) :
   - prix UEX : toujours ;
   - wiki et cargo : si le changenum installé diffère du dernier changenum réussi pour cette source
     (AppMeta `autoSync.changenum.<source>`). Sans marqueur (première fois) : synchro seulement si
     `get_patch_status` dit `patch_detected` ; sinon on pose le marqueur sans synchroniser.
   - Jeu introuvable : prix UEX seulement.
   - Ordre wiki → cargo → uex. Une source n'enregistre son marqueur que si toutes ses étapes ont
     réussi : sinon elle réessaie au lancement suivant.
3. **Pastille** en haut pendant la synchro : « Synchro auto · <source> », « Plans 342/1 624 » pendant
   les plans. Clic → Réglages › Données. Les boutons de synchro sont désactivés pendant ce temps.
4. **Notification** à la fin d'une synchro de patch seulement : « Données à jour pour le patch X »
   ou « Synchro auto incomplète : <sources> ». Rien pour les prix UEX seuls.
5. Interrupteur allumé : pas de notification Rust « Nouveau patch SC », pas d'alerte Accueil
   « Nouveau patch » (les deux restent quand il est éteint).
6. Lignes de sources : pastille « auto · à chaque lancement » (UEX) ou « auto · au prochain patch ».

## Architecture
- `src/lib/autoSync.ts` (pur) : clés AppMeta, `isAutoSyncEnabled`, `planAutoSync`.
- `src/pages/Settings/lib/syncGroups.ts` : étapes et `runGroup` / `runSources` partagés entre les
  boutons et la synchro auto (déplacés de `useDataSync`).
- `src/hooks/useAutoSync.ts` : orchestration au lancement + petit store (pastille, interrupteur).
- `src/components/AutoSyncBadge.tsx`, `pages/Settings/panels/data/AutoSyncCard.tsx`.
- Rust : commande `notify_data_sync(title, body)` ; `check_patch` ignoré si synchro auto allumée.

## Erreurs et cas limites
Hors ligne : les étapes échouent, rien n'est marqué, nouvel essai au lancement suivant. Synchro
manuelle en cours : aucun chevauchement (même store d'occupation).

## Vérification
- Tests : `isAutoSyncEnabled`, `planAutoSync` (UEX seul, nouveau patch, marqueur absent +
  patch_detected / up_to_date, jeu introuvable, une source déjà faite), alerte Accueil.
- tsc, lint, vitest, clippy, cargo test. Essai réel par André.
