// Orchestration de la synchronisation d'onboarding (premier setup RSI) — module PUR
// (aucun hook React). L'état, le déclenchement et le rendu vivent au niveau GLOBAL
// (GameProvider + Layout) pour survivre aux changements d'onglet : la sync, la
// pastille et la modale partagent une source unique.
//
// Chaque étape est isolée dans son propre try/catch : un échec n'interrompt pas la
// chaîne, il est collecté puis montré dans le récap final (relançable dans les
// Réglages). Aucune nouvelle commande backend : on enchaîne les syncs existantes.

import { invoke } from "@tauri-apps/api/core";

export const ONBOARDING_FLAG = "onboarding.completed";

export type StepStatus = "pending" | "running" | "ok" | "failed";

export interface OnboardingStep {
  key: string; // suffixe de clé i18n (onboarding.step.<key>)
  status: StepStatus;
}

// Progression de la pastille topbar en mode « onboarding ». null = pas de sync en
// cours → pastille masquée. `label` est le texte affiché TEL QUEL
// (ex. « Synchronisation · 45% » pour la chaîne, « Plans 342/1559 » pour blueprints
// en arrière-plan) → la pastille n'ajoute aucun suffixe.
export interface OnboardingProgress {
  active: boolean;
  label: string;
}

// Étapes ordonnées. `background: true` → lancée mais NON ATTENDUE (tourne
// en arrière-plan, suivie via les events wiki:sync-progress) : l'onboarding visible
// se termine sans elle. NE PAS inclure sync_fleet_from_scrape : déjà fait dans
// finalizeRsiLogin.
const STEP_DEFS: Array<{ key: string; cmd: string; background?: boolean }> = [
  // a. Wiki (catalogues)
  { key: "shipData", cmd: "sync_ship_data" },
  { key: "components", cmd: "sync_components" },
  // blueprints : Phase 2 = détail des ~1559 plans (15-30 min) → arrière-plan, lancée
  // après components (dont elle bénéficie) mais sans bloquer la suite de la chaîne.
  { key: "blueprints", cmd: "sync_blueprints", background: true },
  { key: "missions", cmd: "sync_missions" },
  // b. Cargo / prix. sync_cargo_reference inclut DÉJÀ la sync des positions (étape
  // interne isolée) → pas de sync_cargo_positions séparé (ce serait un doublon réseau).
  { key: "cargoRef", cmd: "sync_cargo_reference" },
  // Carte galactique : API RSI (repli Wiki si RSI indisponible et aucune donnée RSI).
  // APRÈS les positions Cargo qu'elle relit (WikiLocationPosition/WikiStarmapLocation).
  { key: "starmap", cmd: "sync_starmap" },
  { key: "uex", cmd: "sync_uex_prices" },
  // Catalogue UEX : items vendables + marché des vaisseaux (tables disjointes, UEX
  // public). Après les prix UEX, dans le même bloc.
  { key: "itemCat", cmd: "sync_item_catalog" },
  { key: "vehMkt", cmd: "sync_vehicle_marketplace" },
  // Images des objets (SC Wiki) : APRÈS sync_item_catalog qui recrée la table Item
  // (DELETE puis INSERT) — sinon les imageUrl seraient effacées.
  { key: "itemImg", cmd: "sync_item_images" },
];

export interface OnboardingChainHandlers {
  // Met à jour la liste des étapes (fonction de mise à jour, pour rester atomique).
  setSteps: (updater: (prev: OnboardingStep[]) => OnboardingStep[]) => void;
  // Pilote la pastille de progression (null = la masquer). `label` affiché tel quel.
  setProgress: (value: OnboardingProgress | null) => void;
  // Libellé de base localisé de la pastille (« Synchronisation »). La chaîne y ajoute
  // le pourcentage. Lu à chaque pas → suit la langue.
  badgeLabel: () => string;
  // Lance une étape de fond (blueprints) SANS l'attendre : marquage « en cours »,
  // exécution + suivi de la sous-progression sont gérés par le provider (global),
  // pour survivre à la fin de l'onboarding visible et aux changements d'onglet.
  startBackground: (def: { key: string; cmd: string }) => void;
}

// Enchaîne les syncs VISIBLES (toutes sauf les `background`). Ne gère ni le flag, ni
// started/done, ni la pastille finale : c'est le rôle de l'appelant (le provider),
// qui encadre cet appel et gère la transition de la pastille vers le suivi blueprints.
export async function runOnboardingChain(h: OnboardingChainHandlers): Promise<void> {
  h.setSteps(() => STEP_DEFS.map((d) => ({ key: d.key, status: "pending" as StepStatus })));

  // Le pourcentage de la pastille ne compte QUE les étapes visibles (blueprints, en
  // fond, n'entre pas dans le dénominateur → la barre atteint 100% sans l'attendre).
  const visibleTotal = STEP_DEFS.filter((d) => !d.background).length;
  const setStep = (key: string, status: StepStatus) =>
    h.setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status } : s)));
  const pushBadge = (completed: number) =>
    h.setProgress({
      active: true,
      label: `${h.badgeLabel()} · ${Math.round((completed / visibleTotal) * 100)}%`,
    });
  pushBadge(0);

  let completed = 0;
  for (const def of STEP_DEFS) {
    // Étape de fond (blueprints) : lancée et NON attendue → la chaîne continue.
    if (def.background) {
      h.startBackground({ key: def.key, cmd: def.cmd });
      continue;
    }

    setStep(def.key, "running");
    try {
      await invoke(def.cmd);
      setStep(def.key, "ok");
    } catch {
      // Échec isolé : on continue la chaîne, l'étape est marquée échouée.
      setStep(def.key, "failed");
    }
    completed += 1;
    pushBadge(completed);
  }

  // NE PAS masquer la pastille ici : le provider décide (blueprints peut continuer
  // en arrière-plan → la pastille bascule sur la sous-progression « Plans X/total »).
}
