import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Rocket,
  GitMerge,
  Wrench,
  Box,
  Map,
  FileText,
  Shirt,
  Scale,
  Truck,
  Store,
  Newspaper,
  Warehouse,
  ShieldCheck,
  ScrollText,
  Settings,
  Home,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher } from "./AccountSwitcher";
import { NotificationBell } from "./NotificationBell";
import { ToastProvider, useToast } from "./Toast";
import { closeRsiLoginWindow } from "../lib/rsiSync";
import { DataminingProvider, useDatamining } from "../contexts/DataminingContext";
import { DataminingBadge } from "./DataminingBadge";
import { DataminingConsentModal } from "./DataminingConsentModal";
import OnboardingSyncModal from "./OnboardingSyncModal";
import { StarsBackground } from "./StarsBackground";
import type { AppSettings } from "../hooks/useAppSettings";
import { check } from "@tauri-apps/plugin-updater";

export type CategoryKey = "ships" | "commerce" | "market" | "info";

export type NavItem = {
  to: string;
  icon: LucideIcon;
  // Clé i18n du libellé (résolue via t() au rendu — nav du bas + section Réglages).
  labelKey: string;
  // Clé i18n de la description courte (carte de la page Fonctionnalités).
  descKey: string;
  // Catégorie de regroupement dans la page Fonctionnalités.
  category: CategoryKey;
};

// Catégories de la page Fonctionnalités (ordre d'affichage). La couleur teinte l'icône
// de section + des cartes (mid-tons lisibles en thème sombre).
export type FeatureCategory = { key: CategoryKey; labelKey: string; icon: LucideIcon; color: string };
export const FEATURE_CATEGORIES: FeatureCategory[] = [
  { key: "ships", labelKey: "features.cat.ships", icon: Rocket, color: "#7F77DD" },
  { key: "commerce", labelKey: "features.cat.commerce", icon: Truck, color: "#2ee9a5" },
  { key: "market", labelKey: "features.cat.market", icon: Store, color: "#f5a623" },
  { key: "info", labelKey: "features.cat.info", icon: Newspaper, color: "#5aa9e6" },
];

// Fonctionnalités regroupées dans l'onglet Fonctionnalités (Home et Paramètres sont des
// boutons dédiés de la nav, hors de cette liste). Exporté pour la page Fonctionnalités ET
// la section « Personnaliser la nav bar » des paramètres.
export const FEATURE_ITEMS: NavItem[] = [
  { to: "/fleet", icon: Rocket, labelKey: "nav.fleet", descKey: "features.desc.fleet", category: "ships" },
  { to: "/ccu-chain", icon: GitMerge, labelKey: "nav.ccuChain", descKey: "features.desc.ccuChain", category: "ships" },
  { to: "/loadout", icon: Wrench, labelKey: "nav.loadout", descKey: "features.desc.loadout", category: "ships" },
  { to: "/comparator", icon: Scale, labelKey: "nav.comparator", descKey: "features.desc.comparator", category: "ships" },
  { to: "/insurance", icon: ShieldCheck, labelKey: "nav.insurance", descKey: "features.desc.insurance", category: "ships" },
  { to: "/cargo-routes", icon: Truck, labelKey: "nav.cargoRoutes", descKey: "features.desc.cargoRoutes", category: "commerce" },
  { to: "/crafting", icon: Box, labelKey: "nav.craftingHub", descKey: "features.desc.craftingHub", category: "commerce" },
  { to: "/hangar-exec", icon: Warehouse, labelKey: "nav.hangarExec", descKey: "features.desc.hangarExec", category: "commerce" },
  { to: "/starmap", icon: Map, labelKey: "nav.starmap", descKey: "features.desc.starmap", category: "commerce" },
  { to: "/catalogue", icon: Store, labelKey: "nav.catalogue", descKey: "features.desc.catalogue", category: "market" },
  { to: "/items", icon: Shirt, labelKey: "nav.items", descKey: "features.desc.items", category: "market" },
  { to: "/news", icon: Newspaper, labelKey: "nav.news", descKey: "features.desc.news", category: "info" },
  { to: "/intel", icon: FileText, labelKey: "nav.missionHub", descKey: "features.desc.missionHub", category: "info" },
  { to: "/journal", icon: ScrollText, labelKey: "nav.journal", descKey: "features.desc.journal", category: "info" },
];

/* ───────────────────────────── Barre du haut ───────────────────────────── */

function TopBar() {
  return (
    <header className="relative flex h-16 shrink-0 items-center justify-center px-6">
      {/* Pastille Datamining à gauche (cachée si SC non détecté). */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2">
        <DataminingBadge />
      </div>
      <AccountSwitcher />
      {/* Cloche à droite du header, à côté de la zone compte. Se masque seule
          quand il n'y a aucune notif (cf. NotificationBell). */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2">
        <NotificationBell />
      </div>
    </header>
  );
}

/* ─────────────────────── Nav bar flottante du bas ──────────────────────── */

function NavButton({
  active,
  onClick,
  icon: Icon,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
        active
          ? "bg-[var(--accent)] text-white"
          : "text-white/60 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [pinned, setPinned] = useState<string[]>([]);

  // Raccourcis épinglés (persistés en AppMeta). Rechargés sur changement (event Settings).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<string[]>("get_pinned_nav")
        .then((p) => {
          if (!cancelled) setPinned(p);
        })
        .catch(() => {});
    void load();
    const un = listen("navbar:pinned-changed", () => void load());
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);

  const path = location.pathname;
  const onHome = path.startsWith("/dashboard");
  const onSettings = path.startsWith("/settings");
  const onFeatures = path.startsWith("/features");

  const pinnedItems = pinned
    .map((r) => FEATURE_ITEMS.find((i) => i.to === r))
    .filter((x): x is NavItem => !!x);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
      <div
        className="pointer-events-auto flex flex-col overflow-hidden rounded-[26px] border border-white/10 backdrop-blur-2xl"
        style={{ background: "rgba(18,18,26,0.82)", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}
      >
        {/* Rangée de boutons : Home → raccourcis épinglés → Fonctionnalités → roue */}
        <div className="flex items-center justify-center gap-1 p-1.5">
          <NavButton active={onHome} onClick={() => navigate("/dashboard")} icon={Home} title={t("layout.home")} />

          {pinnedItems.map((item) => (
            <NavButton
              key={item.to}
              active={path.startsWith(item.to)}
              onClick={() => navigate(item.to)}
              icon={item.icon}
              title={t(item.labelKey)}
            />
          ))}

          <button
            onClick={() => navigate("/features")}
            title={t("layout.features")}
            className={[
              "flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
              onFeatures
                ? "bg-[var(--accent)] text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            <span>{t("layout.features")}</span>
          </button>

          <NavButton active={onSettings} onClick={() => navigate("/settings")} icon={Settings} title={t("layout.settings")} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Pont notifs → toasts in-app (Lot 3) ─────────────── */

// Écoute notification:new (émis par create_notification, Lot 1) et déclenche un
// toast in-app SI le canal « In-app » est activé (AppSettings.notifInApp). Le canal
// In-app est indépendant du canal Système ; l'entrée en base / la cloche restent
// inchangées. Lu à chaque event pour refléter l'état courant des réglages.
function NotificationToastBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const pending = listen<{ title: string; body: string }>("notification:new", async (e) => {
      try {
        const s = await invoke<{ notifInApp: boolean }>("get_app_settings");
        if (!s.notifInApp) return;
        toast({ type: "warning", title: e.payload.title, message: e.payload.body });
      } catch {
        /* silencieux : pas de toast si lecture des réglages impossible */
      }
    });
    return () => {
      void pending.then((un) => un());
    };
  }, [toast]);

  return null;
}

/* ─────────── Anti-fuite de session RSI entre comptes (Fix A) ─────────── */

// Au changement de compte (event "account:switched"), détruit la fenêtre rsi-login
// éventuellement ouverte sur l'ancien compte — réplique du destroyRsiWindow() de la V1,
// pour qu'aucune session ne « fuite » d'un compte à l'autre. Monté dans le shell
// (toujours présent), indépendamment de la page courante.
function RsiSwitchSessionGuard() {
  useEffect(() => {
    const pending = listen("account:switched", async () => {
      // Détruit la fenêtre éventuelle (A) PUIS purge les cookies RSI du profil partagé
      // (via la fenêtre principale) — aucune session ne fuit vers le compte suivant.
      await closeRsiLoginWindow();
      await invoke("purge_rsi_cookies").catch(() => {});
    });
    return () => {
      void pending.then((un) => un());
    };
  }, []);
  return null;
}

/* ─────────── Vérif MAJ auto au lancement (silencieuse) ─────────── */

// Un seul check() au démarrage : si une MAJ est dispo → toast discret (non bloquant).
// Rien si à jour ou erreur (404 attendu tant qu'aucune release publiée). Pas de timer.
function UpdateAutoCheck() {
  const { toast } = useToast();
  const { t } = useTranslation();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const u = await check();
        if (!cancelled && u) {
          toast({
            type: "warning",
            title: t("layout.updateAvailableTitle"),
            message: t("layout.updateAvailableBody", { version: u.version }),
          });
        }
      } catch {
        /* silencieux : 404/réseau attendu tant qu'aucune release n'est publiée */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, t]);
  return null;
}

/* ─────────── Fond étoilé (toggle animatedStarsBg, live) ─────────── */

// Charge le flag depuis AppSettings au montage, écoute "hud:stars-changed" (émis
// par le toggle des Réglages) pour activer/désactiver en direct sans recharger.
function StarsLayer() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("get_app_settings")
      .then((s) => {
        if (!cancelled) setEnabled(s?.animatedStarsBg === 1);
      })
      .catch(() => {});
    const un = listen<boolean>("hud:stars-changed", (e) => setEnabled(!!e.payload));
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);
  return enabled ? <StarsBackground /> : null;
}

/* Hôte GLOBAL de la modale d'onboarding : rendu dans le provider (à côté de la
 * pastille), donc affichable depuis n'importe quelle page. La pastille rouvre la
 * modale via setOnboardingModalOpen ; ici on lit l'état global (étapes/started/done).
 * À la fin (pastille masquée), si la modale est encore ouverte elle montre le récap. */
function OnboardingSyncModalHost() {
  const {
    onboardingStarted,
    onboardingModalOpen,
    onboardingSteps,
    onboardingDone,
    onboardingBlueprintsRunning,
    setOnboardingModalOpen,
  } = useDatamining();
  if (!onboardingStarted || !onboardingModalOpen) return null;
  return (
    <OnboardingSyncModal
      steps={onboardingSteps}
      done={onboardingDone}
      blueprintsRunning={onboardingBlueprintsRunning}
      onClose={() => setOnboardingModalOpen(false)}
    />
  );
}

/* ──────────────────────────────── Layout ───────────────────────────────── */

export function Layout() {
  return (
    <ToastProvider>
      <DataminingProvider>
      <div className="relative h-full w-full overflow-hidden">
        {/* Fond glassmorphique global. Glow teinté depuis l'accent (--bg-glow-1/2,
            posés par applyAccent) ; fallback = valeurs par défaut indigo/violet
            pour le 1er paint avant chargement. Base #0a0a0f inchangée (neutre). */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(ellipse at 20% 50%, var(--bg-glow-1, rgba(99,102,241,0.15)) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, var(--bg-glow-2, rgba(139,92,246,0.10)) 0%, transparent 50%), #0a0a0f",
          }}
        />

        {/* Fond étoilé (au-dessus du glow z-0, sous le contenu z-10). */}
        <StarsLayer />

        <div className="relative z-10 flex h-full w-full flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-auto pb-28">
            <Outlet />
          </main>
          <BottomNav />
        </div>

        <NotificationToastBridge />
        <RsiSwitchSessionGuard />
        <DataminingConsentModal />
        <OnboardingSyncModalHost />
        <UpdateAutoCheck />
      </div>
      </DataminingProvider>
    </ToastProvider>
  );
}

export default Layout;
