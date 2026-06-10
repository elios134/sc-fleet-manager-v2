import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import {
  applyAccent,
  DEFAULT_ACCENT,
  DEFAULT_ANIMATIONS,
  DEFAULT_HUD_INTENSITY,
  type AppSettings,
} from "../hooks/useAppSettings";

type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type Tab = "comptes" | "hud";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("comptes");

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">Paramètres</h1>
        <p className="mt-1 text-sm text-white/50">Comptes et personnalisation HUD</p>
      </header>

      {/* Onglets */}
      <div className="mb-6 inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        <TabButton active={tab === "comptes"} onClick={() => setTab("comptes")}>
          Comptes
        </TabButton>
        <TabButton active={tab === "hud"} onClick={() => setTab("hud")}>
          HUD
        </TabButton>
      </div>

      {tab === "comptes" ? <ComptesTab /> : <HudTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────── Onglet Comptes ─────────────────────────── */

function ComptesTab() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        invoke<Account[]>("get_accounts"),
        invoke<string | null>("get_active_account_id"),
      ]);
      setAccounts(list);
      setActiveId(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function activate(id: number) {
    try {
      await invoke("set_active_account", { accountId: String(id) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: number) {
    const wasActive = String(id) === activeId;
    try {
      await invoke("delete_account", { accountId: String(id) });
      if (wasActive) {
        navigate("/");
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {accounts.map((acc) => {
          const isActive = String(acc.id) === activeId;
          return (
            <div
              key={acc.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <span className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-white">{acc.handle}</span>
                  {isActive && (
                    <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                      Actif
                    </span>
                  )}
                </div>
                {acc.displayName && (
                  <span className="block truncate text-sm text-white/50">{acc.displayName}</span>
                )}
              </div>

              {!isActive && (
                <button
                  onClick={() => activate(acc.id)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                >
                  Activer
                </button>
              )}
              <button
                onClick={() => remove(acc.id)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
              >
                Supprimer
              </button>
            </div>
          );
        })}

        {accounts.length === 0 && (
          <p className="text-sm text-white/40">Aucun compte enregistré.</p>
        )}
      </div>

      <button
        onClick={() => navigate("/")}
        className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
      >
        + Ajouter un compte
      </button>
    </div>
  );
}

/* ───────────────────────────── Onglet HUD ───────────────────────────── */

function HudTab() {
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [animations, setAnimations] = useState(DEFAULT_ANIMATIONS === 1);
  const [hudIntensity, setHudIntensity] = useState(DEFAULT_HUD_INTENSITY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("get_app_settings")
      .then((s) => {
        if (cancelled || !s) return;
        if (typeof s.accentColor === "string") setAccentColor(s.accentColor);
        if (typeof s.animationsEnabled === "number") setAnimations(s.animationsEnabled === 1);
        if (typeof s.hudGlowIntensity === "number") setHudIntensity(s.hudGlowIntensity);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: string, value: string) {
    try {
      await invoke("update_app_settings", { key, value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onAccentChange(value: string) {
    setAccentColor(value);
    applyAccent(value);
    void save("accentColor", value);
  }

  function onAnimationsChange(checked: boolean) {
    setAnimations(checked);
    void save("animationsEnabled", checked ? "1" : "0");
  }

  function onIntensityChange(value: number) {
    setHudIntensity(value);
    void save("hudGlowIntensity", value.toString());
  }

  function reset() {
    onAccentChange(DEFAULT_ACCENT);
    onAnimationsChange(DEFAULT_ANIMATIONS === 1);
    onIntensityChange(DEFAULT_HUD_INTENSITY);
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {/* Couleur d'accent */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">Couleur d'accent</p>
            <p className="text-sm text-white/50">Teinte principale de l'interface</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/60">{accentColor}</span>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => onAccentChange(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
          </div>
        </div>

        {/* Animations */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">Animations</p>
            <p className="text-sm text-white/50">Effets de transition et de mouvement</p>
          </div>
          <button
            role="switch"
            aria-checked={animations}
            onClick={() => onAnimationsChange(!animations)}
            className={[
              "relative h-6 w-11 rounded-full transition-colors",
              animations ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                animations ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Intensité HUD */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Intensité du HUD</p>
              <p className="text-sm text-white/50">Luminosité des effets de halo</p>
            </div>
            <span className="text-sm text-white/60">{hudIntensity}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={hudIntensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <button
          onClick={reset}
          className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
