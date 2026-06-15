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
  const lastLogRef = useRef<string>("");

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
