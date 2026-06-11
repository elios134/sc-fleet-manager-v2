import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import logo from "../assets/logo.png";

type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type RsiSessionStatus = { hasToken: boolean; portraitUrl: string | null };

type View = "idle" | "rsi";

export default function StartPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [portraits, setPortraits] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<View>("idle");
  const [rsiStatus, setRsiStatus] = useState<string | null>(null);

  const [showManual, setShowManual] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Champ d'étoiles scintillantes (généré une fois).
  const stars = useMemo(
    () =>
      Array.from({ length: 48 }, () => ({
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 1.6 + 0.6,
        delay: Math.random() * 4,
        dur: 2.5 + Math.random() * 3.5,
      })),
    [],
  );

  const loadAccounts = useCallback(async () => {
    try {
      const list = await invoke<Account[]>("get_accounts");
      setAccounts(list);
      // Portraits RSI (non bloquant).
      await Promise.all(
        list.map(async (a) => {
          try {
            const s = await invoke<RsiSessionStatus>("get_rsi_session_status", {
              handle: a.handle,
            });
            setPortraits((prev) => ({ ...prev, [a.handle]: s.portraitUrl }));
          } catch {
            /* ignore */
          }
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // Log de diagnostic temporaire : confirme quelle source du handle (a/b/c) a marché
  // sur /account/profile. André copiera ce [rsi-profile-debug] pour validation.
  useEffect(() => {
    const un = listen("rsi-profile-debug", (e) => {
      console.log("[rsi-profile-debug]", e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  async function selectAccount(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("set_active_account", { accountId: String(id) });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleManualCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<Account>("create_account", {
        handle: trimmed,
        displayName: displayName.trim() || null,
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  // Login direct AUTOMATIQUE (calqué V1) : ouvre la fenêtre sur /account/pledges et
  // poll l'état ; dès que l'utilisateur est connecté + page pledges prête → scrape
  // auto → fermeture auto → Dashboard. Recharge auto en cas de "session expired".
  function connectRsiDirect() {
    setError(null);
    setView("rsi");
    setRsiStatus("Ouverture de la fenêtre RSI…");
    try {
      const win = new WebviewWindow("rsi-login", {
        url: "https://robertsspaceindustries.com/en/account/pledges",
        title: "Connexion RSI — SC Fleet Manager",
        width: 1024,
        height: 768,
        center: true,
        incognito: true,
      });
      win.once("tauri://error", (e) => {
        console.error("window error", e);
        setError("Impossible d'ouvrir la fenêtre RSI.");
        setView("idle");
        setRsiStatus(null);
      });
      win.once("tauri://created", () => {
        setRsiStatus("Connectez-vous à RSI — le scrape démarrera automatiquement.");
        let interval: ReturnType<typeof setInterval>;
        let safety: ReturnType<typeof setTimeout>;
        let reloadedOnce = false;
        let busy = false;
        // Refresh auto initial à 3s (évite le refresh manuel sur "session expired").
        const refreshTimer = setTimeout(() => {
          void invoke("reload_rsi_login").catch(() => {});
        }, 3000);
        const stop = () => {
          clearInterval(interval);
          clearTimeout(safety);
          clearTimeout(refreshTimer);
        };
        interval = setInterval(async () => {
          if (busy) return;
          try {
            const res = await invoke<{ status: string }>("check_rsi_login_status");
            if (res.status === "logged_in") {
              busy = true;
              stop();
              await finalizeRsiLogin(win);
            } else if (res.status === "session_expired" && !reloadedOnce) {
              reloadedOnce = true;
              setRsiStatus("Session expirée — rechargement automatique…");
              await invoke("reload_rsi_login");
            } else if (res.status === "closed") {
              stop();
              setView("idle");
              setRsiStatus(null);
            }
          } catch (e) {
            console.error("poll error", e);
          }
        }, 2000);
        safety = setTimeout(() => clearInterval(interval), 300_000);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView("idle");
      setRsiStatus(null);
    }
  }

  // Déclenché AUTOMATIQUEMENT par le polling dès la connexion : scrape pledges →
  // ouverture du panneau compte (clic avatar) pour lire le handle (absent du HTML
  // statique, toutes les pages RSI sont des SPA) → compte → session → sync.
  async function finalizeRsiLogin(win: WebviewWindow) {
    try {
      setRsiStatus("Scraping de votre hangar… (ne ferme pas la fenêtre)");
      const result = await invoke<{ pledges: unknown[]; handle: string | null }>(
        "scrape_rsi_hangar",
      );

      // Le handle n'est pas dans le HTML statique → on ouvre le panneau compte (clic
      // avatar) pour le lire. Repli : handle éventuel du scrape.
      setRsiStatus("Identification de votre compte…");
      const fromPanel = await invoke<string | null>("extract_handle_via_panel");
      const detected = (fromPanel ?? result.handle ?? "").trim();
      if (!detected) {
        setError("Handle RSI introuvable. Réessaie la connexion.");
        setView("idle");
        setRsiStatus(null);
        await win.close().catch(() => {});
        return;
      }

      const existing = accounts.find(
        (a) => a.handle.toLowerCase() === detected.toLowerCase(),
      );
      if (existing) {
        await invoke("set_active_account", { accountId: String(existing.id) });
      } else {
        await invoke<Account>("create_account", { handle: detected, displayName: null });
      }
      await invoke("extract_and_store_rsi_session", { handle: detected });

      setRsiStatus("Synchronisation de votre flotte…");
      await invoke("sync_fleet_from_scrape", { handle: detected, pledges: result.pledges });
      await emit("fleet:synced");

      await win.close().catch(() => {});
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView("idle");
      setRsiStatus(null);
      await win.close().catch(() => {});
    }
  }

  const isRsi = view === "rsi";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-auto p-8">
      {/* Keyframes locaux */}
      <style>{`
        @keyframes sp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-9px)} }
        @keyframes sp-glow {
          0%,100%{filter:drop-shadow(0 0 16px rgba(99,102,241,0.35))}
          50%{filter:drop-shadow(0 0 34px rgba(99,102,241,0.7))}
        }
        @keyframes sp-twinkle { 0%,100%{opacity:.15} 50%{opacity:.85} }
      `}</style>

      {/* Fond glassmorphique */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.10) 0%, transparent 50%), #0a0a0f",
        }}
      />
      {/* Étoiles scintillantes */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {stars.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              animation: `sp-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center">
        {/* Logo hero animé */}
        <div
          className="flex items-center justify-center transition-all duration-500 ease-out"
          style={{ width: isRsi ? 104 : 236, height: isRsi ? 104 : 236 }}
        >
          <img
            src={logo}
            alt="RSI Terminal"
            className="h-full w-full object-contain"
            style={{
              animation: isRsi
                ? "sp-glow 4s ease-in-out infinite"
                : "sp-float 6s ease-in-out infinite, sp-glow 4s ease-in-out infinite",
            }}
          />
        </div>

        <header className="mt-4 text-center transition-all duration-500">
          <h1 className="text-3xl font-bold tracking-[0.2em] text-white">RSI TERMINAL</h1>
          <p className="mt-2 text-sm text-white/50">
            {isRsi ? "Connexion à Star Citizen…" : "Sélectionnez votre commandant"}
          </p>
        </header>

        {error && (
          <p className="mt-6 w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {/* ── Vue RSI (login en cours) ── */}
        {isRsi ? (
          <div className="mt-8 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
            <div className="flex items-center gap-3 text-white/80">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-[var(--accent)]" />
              <span className="text-sm">{rsiStatus ?? "Connexion…"}</span>
            </div>
            <p className="text-xs text-white/40">
              Connectez-vous à votre compte dans la fenêtre RSI. Le scrape de votre
              hangar se lancera automatiquement.
            </p>
            <button
              onClick={() => {
                setView("idle");
                setRsiStatus(null);
                void WebviewWindow.getByLabel("rsi-login").then((w) => w?.close());
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10"
            >
              Annuler
            </button>
          </div>
        ) : (
          /* ── Vue idle ── */
          <div className="mt-8 w-full">
            {/* Cartes commandant */}
            {accounts.length > 0 && (
              <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {accounts.map((acc) => {
                  const portrait = portraits[acc.handle] ?? null;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => selectAccount(acc.id)}
                      disabled={busy}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:opacity-50"
                    >
                      {portrait ? (
                        <img
                          src={portrait}
                          alt={acc.handle}
                          className="h-11 w-11 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-white">
                          {acc.handle}
                        </span>
                        {acc.displayName && (
                          <span className="block truncate text-sm text-white/50">
                            {acc.displayName}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Bouton Connexion RSI (chemin principal) */}
            <button
              onClick={connectRsiDirect}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-3.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30"
            >
              Connexion RSI
            </button>

            {/* Repli discret : création manuelle */}
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowManual((v) => !v)}
                className="text-xs font-medium text-white/40 hover:text-white/70 hover:underline"
              >
                {showManual ? "Masquer" : "Créer un compte manuellement"}
              </button>
            </div>

            {showManual && (
              <form
                onSubmit={handleManualCreate}
                className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-5"
              >
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="Handle RSI (requis)"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Nom affiché (optionnel)"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy || !handle.trim()}
                    className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Créer
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
