import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
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
  ShieldCheck,
  Settings,
  Home,
  LayoutGrid,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher } from "./AccountSwitcher";
import { NotificationBell } from "./NotificationBell";
import { ToastProvider, useToast } from "./Toast";
import { closeRsiLoginWindow } from "../lib/rsiSync";
import { DataminingProvider } from "../contexts/DataminingContext";
import { DataminingBadge } from "./DataminingBadge";
import { DataminingConsentModal } from "./DataminingConsentModal";
import { StarsBackground } from "./StarsBackground";
import type { AppSettings } from "../hooks/useAppSettings";
import { check } from "@tauri-apps/plugin-updater";

export type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
};

// Fonctionnalités listées dans le menu déroulant de la nav du bas (Home et Paramètres
// sont des boutons dédiés, hors de cette liste). Exporté pour la section « Personnaliser
// la nav bar » des paramètres.
export const FEATURE_ITEMS: NavItem[] = [
  { to: "/fleet", icon: Rocket, label: "My Fleet" },
  { to: "/ccu-chain", icon: GitMerge, label: "CCU Chain" },
  { to: "/loadout", icon: Wrench, label: "Loadout Planner" },
  { to: "/comparator", icon: Scale, label: "Comparateur" },
  { to: "/crafting", icon: Box, label: "Crafting Hub" },
  { to: "/starmap", icon: Map, label: "Starmap" },
  { to: "/intel", icon: FileText, label: "Mission Intel" },
  { to: "/items", icon: Shirt, label: "Items & Cosmetics" },
  { to: "/insurance", icon: ShieldCheck, label: "Insurance" },
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
  const [open, setOpen] = useState(false);
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

  const pinnedItems = pinned
    .map((r) => FEATURE_ITEMS.find((i) => i.to === r))
    .filter((x): x is NavItem => !!x);
  const menuItems = FEATURE_ITEMS.filter((i) => !pinned.includes(i.to));
  const onFeatureMenu = menuItems.some((i) => path.startsWith(i.to));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
      {/* Bloc englobant unique : le menu pousse la barre vers le haut, sans cassure. */}
      <div
        className="pointer-events-auto flex flex-col overflow-hidden rounded-[26px] border border-white/10 backdrop-blur-2xl"
        style={{ background: "rgba(18,18,26,0.82)", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}
        onMouseLeave={() => setOpen(false)}
      >
        {open && menuItems.length > 0 && (
          <div className="flex flex-col gap-0.5 p-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = path.startsWith(item.to);
              return (
                <button
                  key={item.to}
                  onClick={() => {
                    setOpen(false);
                    navigate(item.to);
                  }}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  <Icon className={["h-4 w-4 shrink-0", active ? "text-[var(--accent)]" : ""].join(" ")} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Rangée de boutons : Home → raccourcis épinglés → Fonctionnalités → roue */}
        <div className="flex items-center justify-center gap-1 p-1.5">
          <NavButton active={onHome} onClick={() => navigate("/dashboard")} icon={Home} title="Accueil" />

          {pinnedItems.map((item) => (
            <NavButton
              key={item.to}
              active={path.startsWith(item.to)}
              onClick={() => navigate(item.to)}
              icon={item.icon}
              title={item.label}
            />
          ))}

          <button
            onMouseEnter={() => setOpen(true)}
            onClick={() => setOpen((v) => !v)}
            title="Fonctionnalités"
            className={[
              "flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
              onFeatureMenu || open
                ? "bg-[var(--accent)] text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            <span>Fonctionnalités</span>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <NavButton active={onSettings} onClick={() => navigate("/settings")} icon={Settings} title="Paramètres" />
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
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const u = await check();
        if (!cancelled && u) {
          toast({
            type: "warning",
            title: "Mise à jour disponible",
            message: `v${u.version} — Réglages › À propos`,
          });
        }
      } catch {
        /* silencieux : 404/réseau attendu tant qu'aucune release n'est publiée */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);
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
        <UpdateAutoCheck />
      </div>
      </DataminingProvider>
    </ToastProvider>
  );
}

export default Layout;
