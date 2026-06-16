// Orchestration de la synchronisation d'onboarding (premier setup RSI) — module PUR
// (aucun hook React). L'état, le déclenchement et le rendu vivent au niveau GLOBAL
// (DataminingProvider + Layout) pour survivre aux changements d'onglet : la sync, la
// pastille et la modale partagent une source unique.
//
// Chaque étape est isolée dans son propre try/catch : un échec n'interrompt pas la
// chaîne, il est collecté puis montré dans le récap final (relançable dans les
// Réglages). Aucune nouvelle commande backend : on enchaîne les syncs existantes.

import { invoke } from "@tauri-apps/api/core";

export const ONBOARDING_FLAG = "onboarding.completed";
const CONSENT_KEY = "datamining.consent";

export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface OnboardingStep {
  key: string; // suffixe de clé i18n (onboarding.step.<key>)
  status: StepStatus;
}

// Progression de la pastille topbar en mode « onboarding ». null = pas de sync en
// cours → pastille en mode datamining normal. `label` est le texte affiché TEL QUEL
// (ex. « Synchronisation · 45% » pour la chaîne, « Plans 342/1559 » pour blueprints
// en arrière-plan) → la pastille n'ajoute aucun suffixe.
export interface OnboardingProgress {
  active: boolean;
  label: string;
}

// Étapes ordonnées. `datamining: true` → conditionnées au pré-check (option B :
// jamais d'extraction longue, on lance seulement starmap/mining/enrich si les
// dumps sont déjà préparés). `background: true` → lancée mais NON ATTENDUE (tourne
// en arrière-plan, suivie via les events wiki:sync-progress) : l'onboarding visible
// se termine sans elle. NE PAS inclure sync_fleet_from_scrape : déjà fait dans
// finalizeRsiLogin. sync_ccu_catalog en dernier (session RSI encore chaude).
const STEP_DEFS: Array<{ key: string; cmd: string; datamining?: boolean; background?: boolean }> = [
  // a. Wiki (catalogues)
  { key: "shipData", cmd: "sync_ship_data" },
  { key: "components", cmd: "sync_components" },
  // blueprints : Phase 2 = détail des ~1559 plans (15-30 min) → arrière-plan, lancée
  // après components (dont elle bénéficie) mais sans bloquer la suite de la chaîne.
  { key: "blueprints", cmd: "sync_blueprints", background: true },
  { key: "missions", cmd: "sync_missions" },
  // b. Cargo / prix
  { key: "cargoRef", cmd: "sync_cargo_reference" },
  { key: "cargoPos", cmd: "sync_cargo_positions" },
  // Carte galactique : source Wiki (réseau, dispo pour TOUS, plus de datamining).
  // APRÈS les positions Cargo qu'elle relit (WikiLocationPosition/WikiStarmapLocation).
  { key: "starmap", cmd: "sync_starmap_from_wiki" },
  { key: "uex", cmd: "sync_uex_prices" },
  // c. Datamining (option B : seulement si dumps préparés)
  { key: "mining", cmd: "sync_mining_locations", datamining: true },
  { key: "enrich", cmd: "enrich_blueprint_stats", datamining: true },
  // d. CCU (dernier)
  { key: "ccu", cmd: "sync_ccu_catalog" },
];

// Forme des retours des commandes utilisées par le pré-check (locale au module).
interface InstallInfo {
  configured: string | null;
  resolved: string | null;
  channel: string | null;
}
interface PathValidation {
  hasDataP4k: boolean;
  hasGameLog: boolean;
}

// Pré-check datamining (option B) : Data.p4k résolu + consentement accordé. On lit
// les valeurs fraîches via les commandes existantes. Les dumps eux-mêmes sont
// validés implicitement par l'appel : si absents, sync_mining_locations/enrich
// échouent → étape « failed » → récap Réglages. On ne lance JAMAIS start_extraction
// (pas d'extraction de 5-30 min).
async function checkDataminingReady(): Promise<boolean> {
  try {
    const inst = await invoke<InstallInfo>("get_sc_install_path");
    if (!inst.resolved) return false;
    const target = inst.resolved ?? inst.configured;
    const val = target
      ? await invoke<PathValidation>("validate_sc_path", { path: target })
      : null;
    const consent = localStorage.getItem(CONSENT_KEY);
    return !!val?.hasDataP4k && consent === "granted";
  } catch {
    return false;
  }
}

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

  const dataminingReady = await checkDataminingReady();

  let completed = 0;
  for (const def of STEP_DEFS) {
    // Étape de fond (blueprints) : lancée et NON attendue → la chaîne continue.
    if (def.background) {
      h.startBackground({ key: def.key, cmd: def.cmd });
      continue;
    }

    // Datamining non préparé → ignoré (à faire manuellement dans les Réglages),
    // sans lancer d'extraction.
    if (def.datamining && !dataminingReady) {
      setStep(def.key, "skipped");
      completed += 1;
      pushBadge(completed);
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
