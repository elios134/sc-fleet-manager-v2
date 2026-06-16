// État Datamining partagé (section Réglages + badge topbar + modale de consentement).
// S'appuie UNIQUEMENT sur les commandes/events backend des Lots 1+2 :
//   start_extraction / cancel_extraction / get_extraction_status
//   validate_sc_path / set_sc_install_path / get_sc_install_path
//   get_patch_status
//   events : datamining:extraction-progress | -completed | -error | -cancelled
// Le consentement est persisté côté front (localStorage) — aucun nouveau backend.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  runOnboardingChain,
  ONBOARDING_FLAG,
  type OnboardingStep,
  type OnboardingProgress,
} from "../lib/onboarding";

export type { OnboardingProgress, OnboardingStep } from "../lib/onboarding";

export type ExtractionState = "idle" | "running" | "cancelling" | "completed" | "error";

export interface ExtractionStatus {
  state: ExtractionState;
  phase: string | null;
  percentOverall: number;
  startedAt: number | null;
  etaSeconds: number | null;
  currentMessage: string;
  errorMessage: string | null;
  tempDir: string | null;
}

export interface InstallInfo {
  configured: string | null;
  resolved: string | null;
  channel: string | null;
}

export interface PathValidation {
  hasDataP4k: boolean;
  hasGameLog: boolean;
}

export type PatchStatusKind = "up_to_date" | "patch_detected" | "unknown";
export interface PatchStatus {
  status: PatchStatusKind;
  installedVersion: string | null;
  installedChannel: string | null;
}

export type Consent = "granted" | "never" | null;

const CONSENT_KEY = "datamining.consent";

// Clés i18n des phases (identifiants émis par le runner Rust → clé de traduction).
export const PHASE_LABEL_KEYS: Record<string, string> = {
  fetching_classnames: "datamining.phase.fetching_classnames",
  querying_ships: "datamining.phase.querying_ships",
  extracting_localization: "datamining.phase.extracting_localization",
  extracting_contracts: "datamining.phase.extracting_contracts",
  extracting_blueprints: "datamining.phase.extracting_blueprints",
  extracting_blueprint_rewards: "datamining.phase.extracting_blueprint_rewards",
  extracting_mining: "datamining.phase.extracting_mining",
  extracting_scitem: "datamining.phase.extracting_scitem",
  applying: "datamining.phase.applying",
};

// Libellé localisé d'une phase. Phase inconnue → identifiant brut (donnée backend).
export function phaseLabel(phase: string | null, t: TFunction): string {
  if (!phase) return t("datamining.phase.unknown");
  const key = PHASE_LABEL_KEYS[phase];
  return key ? t(key) : phase;
}

const IDLE: ExtractionStatus = {
  state: "idle",
  phase: null,
  percentOverall: 0,
  startedAt: null,
  etaSeconds: null,
  currentMessage: "",
  errorMessage: null,
  tempDir: null,
};

interface DataminingContextValue {
  status: ExtractionStatus;
  install: InstallInfo | null;
  validation: PathValidation | null;
  patch: PatchStatus | null;
  consent: Consent;
  // Onboarding (premier setup) — état GLOBAL (survit aux changements d'onglet).
  onboarding: OnboardingProgress | null; // progression pastille (null = masquée)
  onboardingStarted: boolean; // la chaîne a réellement démarré
  onboardingDone: boolean; // la chaîne VISIBLE est terminée (flag posé)
  onboardingBlueprintsRunning: boolean; // blueprints continue en arrière-plan
  onboardingSteps: OnboardingStep[]; // détail live des étapes (pour la modale)
  onboardingModalOpen: boolean;
  setOnboardingModalOpen: (open: boolean) => void;
  triggerOnboarding: () => void; // démarre une fois (idempotent), appelé par le Dashboard
  log: string[];
  running: boolean;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  pickFolder: () => Promise<void>;
  resetPath: () => Promise<void>;
  setConsent: (value: Exclude<Consent, null>) => void;
}

const Ctx = createContext<DataminingContextValue | null>(null);

export function DataminingProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ExtractionStatus>(IDLE);
  const [install, setInstall] = useState<InstallInfo | null>(null);
  const [validation, setValidation] = useState<PathValidation | null>(null);
  const [patch, setPatch] = useState<PatchStatus | null>(null);
  const [consent, setConsentState] = useState<Consent>(
    () => (localStorage.getItem(CONSENT_KEY) as Consent) ?? null,
  );
  const [log, setLog] = useState<string[]>([]);
  // Onboarding — état global. La progression (pastille), le détail des étapes, et
  // les drapeaux started/done vivent ICI (provider monté dans Layout) → ils survivent
  // au démontage du Dashboard, donc la pastille rouvre la modale depuis n'importe où.
  const [onboarding, setOnboarding] = useState<OnboardingProgress | null>(null);
  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([]);
  // blueprints en arrière-plan : reste vrai TANT QUE sync_blueprints tourne (après la
  // fin de l'onboarding visible) → pilote le message final + la persistance de la
  // pastille en mode « Plans X/total ».
  const [onboardingBlueprintsRunning, setOnboardingBlueprintsRunning] = useState(false);
  // Visibilité de la modale, distincte du fait que la sync tourne : la pastille
  // (rouvrir) et la modale (fermer) la pilotent toutes deux.
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const lastLogRef = useRef<string>("");

  // Garde d'idempotence : une seule orchestration par session d'app. Le check + la
  // pose sont synchrones (aucun await entre eux) → atomiques, donc le double-appel
  // StrictMode (effet Dashboard invoqué deux fois) produit exactement UN démarrage.
  const onboardingGuardRef = useRef(false);
  // Réf vers `t` courant pour que le libellé de pastille suive la langue en live.
  const tRef = useRef(t);
  tRef.current = t;
  // Suivi blueprints en fond : chaîne visible terminée ? blueprints encore en cours ?
  // dernière sous-progression connue. Refs (pas d'état) → lus dans le listener/closure.
  const mainChainDoneRef = useRef(false);
  const blueprintsRunningRef = useRef(false);
  const blueprintsBgRef = useRef<{ current: number; total: number } | null>(null);

  // Libellé pastille pour blueprints en fond (« Plans 342/1559 » ou « Plans… »).
  const blueprintsPillLabel = useCallback((bg: { current: number; total: number } | null) => {
    return bg && bg.total > 0
      ? tRef.current("onboarding.badge.blueprints", { current: bg.current, total: bg.total })
      : tRef.current("onboarding.badge.blueprintsStarting");
  }, []);

  const triggerOnboarding = useCallback(async () => {
    if (onboardingGuardRef.current) return;
    // Flag absent requis (en plus de firstLogin côté Dashboard) : ne tourne qu'une fois.
    const flag = await invoke<string | null>("get_app_meta", {
      key: ONBOARDING_FLAG,
    }).catch(() => null);
    if (onboardingGuardRef.current || flag === "1") return;
    onboardingGuardRef.current = true;

    setOnboardingStarted(true);
    setOnboardingModalOpen(true); // modale ouverte au démarrage (refermable/rouvrable)

    const setStep = (key: string, st: OnboardingStep["status"]) =>
      setOnboardingSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status: st } : s)));

    // Lance une étape de fond (blueprints) SANS l'attendre. Marque « en cours »,
    // écoute la sous-progression (events wiki:sync-progress, phase blueprint-details)
    // pour alimenter la pastille une fois la chaîne visible terminée, et nettoie à la
    // résolution. Vit dans le provider (global) → survit au flag et aux changements
    // d'onglet ; n'est PAS interrompue par la fin de l'onboarding visible.
    const startBackground = (def: { key: string; cmd: string }) => {
      setStep(def.key, "running");
      blueprintsRunningRef.current = true;
      setOnboardingBlueprintsRunning(true);

      const unlistenPromise = listen<{ phase?: string; current?: number; total?: number }>(
        "wiki:sync-progress",
        (e) => {
          const p = e.payload ?? {};
          if (p.phase !== "blueprint-details") return; // ignore les autres syncs/phases
          const bg = { current: Number(p.current) || 0, total: Number(p.total) || 0 };
          blueprintsBgRef.current = bg;
          // Met à jour la pastille UNIQUEMENT une fois la chaîne visible terminée
          // (sinon la pastille affiche la progression globale de la chaîne).
          if (mainChainDoneRef.current) {
            setOnboarding({ active: true, label: blueprintsPillLabel(bg) });
          }
        },
      );

      void invoke(def.cmd)
        .then(() => setStep(def.key, "ok"))
        .catch(() => setStep(def.key, "failed"))
        .finally(() => {
          blueprintsRunningRef.current = false;
          blueprintsBgRef.current = null;
          setOnboardingBlueprintsRunning(false);
          setOnboarding(null); // blueprints vraiment fini → la pastille disparaît
          void unlistenPromise.then((u) => u());
        });
    };

    await runOnboardingChain({
      setSteps: setOnboardingSteps,
      setProgress: setOnboarding,
      badgeLabel: () => tRef.current("onboarding.badge.label"),
      startBackground,
    });

    // Chaîne VISIBLE terminée. La pastille bascule : si blueprints tourne encore →
    // sous-progression « Plans X/total » (mise à jour ensuite par le listener) ;
    // sinon (déjà fini) → masquée.
    mainChainDoneRef.current = true;
    if (blueprintsRunningRef.current) {
      setOnboarding({ active: true, label: blueprintsPillLabel(blueprintsBgRef.current) });
    } else {
      setOnboarding(null);
    }

    // Flag posé même si blueprints continue en fond → ne pas re-déclencher l'onboarding
    // au prochain lancement. blueprints en fond survit au flag.
    await invoke("set_app_meta", { key: ONBOARDING_FLAG, value: "1" }).catch(() => {});
    setOnboardingDone(true);
  }, [blueprintsPillLabel]);

  const running = status.state === "running" || status.state === "cancelling";

  const pushLog = useCallback((msg: string) => {
    if (!msg || msg === lastLogRef.current) return;
    lastLogRef.current = msg;
    setLog((prev) => [...prev.slice(-49), msg]); // garde les 50 dernières lignes
  }, []);

  const refreshInstall = useCallback(async () => {
    try {
      const info = await invoke<InstallInfo>("get_sc_install_path");
      setInstall(info);
      const target = info.resolved ?? info.configured;
      if (target) {
        try {
          setValidation(await invoke<PathValidation>("validate_sc_path", { path: target }));
        } catch {
          setValidation(null);
        }
      } else {
        setValidation(null);
      }
    } catch {
      /* non bloquant */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<ExtractionStatus>("get_extraction_status"));
    } catch {
      /* garde l'état courant */
    }
    await refreshInstall();
    try {
      setPatch(await invoke<PatchStatus>("get_patch_status"));
    } catch {
      /* non bloquant */
    }
  }, [refreshInstall]);

  // Abonnement aux events d'extraction (désabonnement au démontage).
  useEffect(() => {
    void refresh();
    const pending: Array<Promise<UnlistenFn>> = [
      listen<ExtractionStatus>("datamining:extraction-progress", (e) => {
        setStatus(e.payload);
        pushLog(
          e.payload.phase
            ? `${phaseLabel(e.payload.phase, t)} — ${e.payload.currentMessage}`
            : e.payload.currentMessage,
        );
      }),
      listen<{ tempDir?: string }>("datamining:extraction-completed", () => {
        void refresh();
      }),
      listen<{ error?: string }>("datamining:extraction-error", (e) => {
        if (e.payload?.error) pushLog(t("datamining.log.errorPrefix", { message: e.payload.error }));
      }),
      listen("datamining:extraction-cancelled", () => {
        pushLog(t("datamining.log.cancelled"));
      }),
    ];
    return () => {
      pending.forEach((p) => void p.then((un) => un()));
    };
  }, [refresh, pushLog, t]);

  const start = useCallback(async () => {
    setLog([]);
    lastLogRef.current = "";
    try {
      await invoke("start_extraction");
    } catch (err) {
      // L'erreur est aussi émise via l'event ; on garde une trace ici.
      pushLog(t("datamining.log.errorPrefix", { message: err instanceof Error ? err.message : String(err) }));
    }
  }, [pushLog, t]);

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel_extraction");
    } catch {
      /* best-effort */
    }
  }, []);

  const pickFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, title: t("datamining.pickFolderTitle") });
    if (typeof picked !== "string") return;
    try {
      await invoke("set_sc_install_path", { path: picked });
    } catch (err) {
      pushLog(t("datamining.log.pathRejected", { message: err instanceof Error ? err.message : String(err) }));
    }
    await refresh();
  }, [refresh, pushLog, t]);

  const resetPath = useCallback(async () => {
    try {
      await invoke("set_sc_install_path", { path: "" });
    } catch {
      /* best-effort */
    }
    await refresh();
  }, [refresh]);

  const setConsent = useCallback((value: Exclude<Consent, null>) => {
    localStorage.setItem(CONSENT_KEY, value);
    setConsentState(value);
  }, []);

  return (
    <Ctx.Provider
      value={{
        status,
        install,
        validation,
        patch,
        consent,
        onboarding,
        onboardingStarted,
        onboardingDone,
        onboardingBlueprintsRunning,
        onboardingSteps,
        onboardingModalOpen,
        setOnboardingModalOpen,
        triggerOnboarding,
        log,
        running,
        refresh,
        start,
        cancel,
        pickFolder,
        resetPath,
        setConsent,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDatamining(): DataminingContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDatamining doit être utilisé dans <DataminingProvider>");
  return ctx;
}
