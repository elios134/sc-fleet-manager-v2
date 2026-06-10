import { NavLink, Outlet } from "react-router";
import {
  Rocket,
  GitMerge,
  Wrench,
  Box,
  Map,
  FileText,
  Shirt,
  RefreshCcw,
  ChevronDown,
  Search,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/fleet", icon: Rocket, label: "My Fleet" },
  { to: "/ccu-chain", icon: GitMerge, label: "CCU Chain" },
  { to: "/loadout", icon: Wrench, label: "Loadout Planner" },
  { to: "/crafting", icon: Box, label: "Crafting Hub", badge: "1500+" },
  { to: "/starmap", icon: Map, label: "Starmap", badge: "257" },
  { to: "/intel", icon: FileText, label: "Mission Intel" },
  { to: "/items", icon: Shirt, label: "Items & Cosmetics" },
];

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-white/10 text-white border border-white/10"
            : "text-white/50 border border-transparent hover:text-white/90 hover:bg-white/5",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={[
              "h-4.5 w-4.5 shrink-0 transition-colors",
              isActive ? "text-[var(--accent)]" : "text-white/50 group-hover:text-white/90",
            ].join(" ")}
          />
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r backdrop-blur-2xl"
      style={{
        background: "var(--sidebar)",
        borderColor: "var(--sidebar-border)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
        <span className="text-base font-semibold tracking-tight text-white">
          RSI Terminal
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>

      {/* Auto-Sync widget */}
      <div className="p-3">
        <div
          className="rounded-2xl border p-4 backdrop-blur-2xl"
          style={{
            background: "var(--card)",
            borderColor: "var(--card-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4 animate-[spin_3s_linear_infinite] text-[var(--accent)]" />
            <span className="text-sm font-medium text-white/90">Auto-Sync</span>
          </div>
          <p className="mt-1 text-xs text-white/40">Syncing fleet data…</p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 rounded-full bg-[var(--accent)]" />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Header() {
  return (
    <header
      className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6 backdrop-blur-2xl"
      style={{
        background: "rgba(255,255,255,0.02)",
        borderColor: "var(--sidebar-border)",
      }}
    >
      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="text"
          placeholder="Search databanks..."
          className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white/90 placeholder:text-white/40 focus:border-white/20 focus:outline-none"
        />
      </div>

      {/* Account button */}
      <button className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3 text-sm text-white/90 transition-colors hover:bg-white/10">
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
        <span className="font-medium">Commandant</span>
        <ChevronDown className="h-4 w-4 text-white/40" />
      </button>
    </header>
  );
}

export function Layout() {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Global glassmorphic background behind everything */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.10) 0%, transparent 50%), #0a0a0f",
        }}
      />

      {/* Foreground layout */}
      <div className="relative z-10 flex h-full w-full">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto rounded-tl-3xl bg-white/[0.01]">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

export default Layout;
