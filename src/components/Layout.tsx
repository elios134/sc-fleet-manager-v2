import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher } from "./AccountSwitcher";

type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
};

// Fonctionnalités listées dans le menu déroulant de la nav du bas (Home et Paramètres
// sont des boutons dédiés, hors de cette liste).
const FEATURE_ITEMS: NavItem[] = [
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
      <AccountSwitcher />
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
  const [featuresOpen, setFeaturesOpen] = useState(false);

  const path = location.pathname;
  const onHome = path.startsWith("/dashboard");
  const onSettings = path.startsWith("/settings");
  const onFeature = FEATURE_ITEMS.some((i) => path.startsWith(i.to));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 p-1.5 backdrop-blur-2xl"
        style={{
          background: "rgba(20,20,28,0.7)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}
      >
        <NavButton active={onHome} onClick={() => navigate("/dashboard")} icon={Home} title="Accueil" />

        {/* Fonctionnalités — menu déroulant vers le haut au survol */}
        <div
          className="relative"
          onMouseEnter={() => setFeaturesOpen(true)}
          onMouseLeave={() => setFeaturesOpen(false)}
        >
          {featuresOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-3">
              <div
                className="w-56 overflow-hidden rounded-2xl border border-white/10 p-1.5 backdrop-blur-2xl"
                style={{ background: "rgba(20,20,28,0.92)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
              >
                {FEATURE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setFeaturesOpen(false)}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-white/10 text-white"
                            : "text-white/60 hover:bg-white/5 hover:text-white",
                        ].join(" ")
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={[
                              "h-4 w-4 shrink-0",
                              isActive ? "text-[var(--accent)]" : "",
                            ].join(" ")}
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          )}
          <NavButton active={onFeature} icon={LayoutGrid} title="Fonctionnalités" />
        </div>

        <NavButton active={onSettings} onClick={() => navigate("/settings")} icon={Settings} title="Paramètres" />
      </div>
    </div>
  );
}

/* ──────────────────────────────── Layout ───────────────────────────────── */

export function Layout() {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Fond glassmorphique global */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.10) 0%, transparent 50%), #0a0a0f",
        }}
      />

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto bg-white/[0.01] pb-28">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}

export default Layout;
