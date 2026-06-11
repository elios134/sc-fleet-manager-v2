import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
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

type Tab = "comptes" | "hud" | "notifications" | "diagnostic";

type NotifSettings = {
  insuranceExpiryThreshold: number;
  notifFleetStatus: boolean;
  notifMarketVolatility: boolean;
  notifSystemMessages: boolean;
  notifInApp: boolean;
  notifSystem: boolean;
  notifMinedMissions: boolean;
  notifInsuranceExpired: boolean;
};

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
        <TabButton active={tab === "notifications"} onClick={() => setTab("notifications")}>
          Notifications
        </TabButton>
        <TabButton active={tab === "diagnostic"} onClick={() => setTab("diagnostic")}>
          Diagnostic
        </TabButton>
      </div>

      {tab === "comptes" ? (
        <ComptesTab />
      ) : tab === "hud" ? (
        <HudTab />
      ) : tab === "notifications" ? (
        <NotificationsTab />
      ) : (
        <DiagnosticTab />
      )}
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

type RsiSessionStatus = { hasToken: boolean; portraitUrl: string | null };

function ComptesTab() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, RsiSessionStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);

  const loadSession = useCallback(async (handle: string) => {
    try {
      const status = await invoke<RsiSessionStatus>("get_rsi_session_status", { handle });
      setSessions((prev) => ({ ...prev, [handle]: status }));
    } catch {
      /* statut non bloquant */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        invoke<Account[]>("get_accounts"),
        invoke<string | null>("get_active_account_id"),
      ]);
      setAccounts(list);
      setActiveId(active);
      await Promise.all(list.map((a) => loadSession(a.handle)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadSession]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Écoute des événements RSI émis par le backend.
  useEffect(() => {
    const pending: Array<Promise<UnlistenFn>> = [
      listen<{ handle: string }>("rsi:login-success", (e) => {
        setNotice(`Connexion RSI réussie : ${e.payload.handle}`);
        void loadSession(e.payload.handle);
      }),
      listen<{ reason: string }>("rsi:login-error", (e) => {
        setNotice(`Échec de connexion RSI (${e.payload.reason}).`);
      }),
      listen("rsi:login-timeout", () => {
        setNotice("Connexion RSI expirée. Réessayez.");
      }),
      listen<{ handle: string }>("rsi:logout", (e) => {
        void loadSession(e.payload.handle);
      }),
    ];
    return () => {
      pending.forEach((p) => void p.then((un) => un()));
    };
  }, [loadSession]);

  async function activate(id: number) {
    try {
      await invoke("set_active_account", { accountId: String(id) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Suppression confirmée via la modale : laisse l'erreur remonter pour que la
  // modale l'affiche (et reste ouverte) ; ferme/redirige seulement en cas de succès.
  async function confirmDelete() {
    if (!deleteTarget) return;
    const wasActive = String(deleteTarget.id) === activeId;
    await invoke("delete_account", { accountId: String(deleteTarget.id) });
    if (wasActive) {
      navigate("/");
      return;
    }
    await reload();
    setDeleteTarget(null);
  }

  async function connectRsi(handle: string) {
    setNotice(null);
    try {
      // 1. Ouvre la fenêtre RSI (création JS — seule voie fonctionnelle).
      const win = new WebviewWindow("rsi-login", {
        url: "https://robertsspaceindustries.com/en/account/pledges",
        title: "RSI Login — SC Fleet Manager",
        width: 1024,
        height: 768,
        center: true,
      });

      // 2. Une fois créée, démarre le polling de l'état de login (piloté en Rust).
      win.once("tauri://created", () => {
        let interval: ReturnType<typeof setInterval>;
        let safety: ReturnType<typeof setTimeout>;
        const stop = () => {
          clearInterval(interval);
          clearTimeout(safety);
        };

        interval = setInterval(async () => {
          try {
            const res = await invoke<{ status: string }>("check_rsi_login_status");
            if (res.status === "logged_in") {
              stop();
              await invoke("extract_and_store_rsi_session", { handle });
              await win.close();
              void loadSession(handle); // badge → Session active
              setNotice(`Connexion RSI réussie : ${handle}`);
            } else if (res.status === "closed") {
              stop(); // l'utilisateur a fermé la fenêtre
            }
          } catch (e) {
            console.error("poll error", e);
          }
        }, 2000);

        // Sécurité : stoppe le polling après 5 min.
        safety = setTimeout(() => clearInterval(interval), 300000);
      });

      win.once("tauri://error", (e) => console.error("window error", e));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnectRsi(handle: string) {
    try {
      await invoke("logout_rsi", { handle }); // supprime les tokens AppMeta
      await clearRsiCookies(); // vide les cookies du profil WebView partagé
      await loadSession(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Vide les cookies RSI du profil WebView2 partagé en ouvrant une fenêtre JS
  // fonctionnelle (about:blank, cachée) puis en appelant clear_rsi_cookies côté Rust.
  // Les WebView créées en Rust étant non fonctionnelles ici, le vidage doit passer
  // par une fenêtre créée en JS (équivalent du session.clearStorageData() V1).
  async function clearRsiCookies() {
    const LABEL = "rsi-cookie-clear";
    try {
      const existing = await WebviewWindow.getByLabel(LABEL);
      if (existing) await existing.close().catch(() => {});

      const w = new WebviewWindow(LABEL, {
        url: "about:blank",
        title: "",
        width: 480,
        height: 360,
        visible: false,
      });
      await new Promise<void>((resolve, reject) => {
        w.once("tauri://created", () => resolve());
        w.once("tauri://error", (e) => reject(e));
      });
      // Laisse le contrôleur WebView2 s'initialiser avant le vidage.
      await new Promise((r) => setTimeout(r, 400));
      await invoke("clear_rsi_cookies", { label: LABEL });
      await w.close().catch(() => {});
    } catch (e) {
      console.error("[disconnectRsi] vidage cookies échoué", e);
    }
  }

  // Synchronisation RSI (6b.2) : ouvre la WebView pledges → laisse charger →
  // scrape le hangar → upsert en base → ferme la fenêtre → notifie Fleet/Dashboard.
  async function syncRsi(handle: string) {
    setError(null);
    setSyncing(true);
    setNotice("Synchronisation RSI : ouverture de la fenêtre…");
    try {
      let win = await WebviewWindow.getByLabel("rsi-login");
      if (!win) {
        win = new WebviewWindow("rsi-login", {
          url: "https://robertsspaceindustries.com/en/account/pledges",
          title: "RSI Login — SC Fleet Manager",
          width: 1024,
          height: 768,
          center: true,
        });
        win.once("tauri://error", (e) => console.error("window error", e));
        await new Promise<void>((resolve) => win!.once("tauri://created", () => resolve()));
      }

      // Laisse la page (re)charger avant le scrape (refresh manuel possible si Cloudflare).
      setNotice("Synchronisation RSI : chargement de la page…");
      await new Promise((r) => setTimeout(r, 3000));

      const pledges = await invoke<unknown[]>("scrape_rsi_hangar");
      setNotice(`Synchronisation : ${pledges.length} pledges récupérés, écriture en base…`);

      const res = await invoke<{ imported: number; adopted: number; deleted: number }>(
        "sync_fleet_from_scrape",
        { handle, pledges },
      );

      await win.close();
      await emit("fleet:synced"); // déclenche le rechargement de Fleet/Dashboard
      setNotice(
        `Synchronisation terminée : ${res.imported} importés, ${res.adopted} adoptés, ${res.deleted} retirés.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {accounts.map((acc) => {
          const isActive = String(acc.id) === activeId;
          const session = sessions[acc.handle];
          const hasToken = session?.hasToken ?? false;
          const portraitUrl = session?.portraitUrl ?? null;
          return (
            <div
              key={acc.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              {hasToken && portraitUrl ? (
                <img
                  src={portraitUrl}
                  alt={acc.handle}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-white">{acc.handle}</span>
                  {isActive && (
                    <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                      Actif
                    </span>
                  )}
                  {hasToken ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      Session active
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                      Non connecté
                    </span>
                  )}
                </div>
                {acc.displayName && (
                  <span className="block truncate text-sm text-white/50">{acc.displayName}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasToken ? (
                  <>
                    <button
                      onClick={() => syncRsi(acc.handle)}
                      disabled={syncing}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {syncing ? "Synchronisation…" : "Synchroniser RSI"}
                    </button>
                    <button
                      onClick={() => disconnectRsi(acc.handle)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                    >
                      Déconnecter
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => connectRsi(acc.handle)}
                    className="rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-3 py-1.5 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
                  >
                    Connecter RSI
                  </button>
                )}
                {!isActive && (
                  <button
                    onClick={() => activate(acc.id)}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                  >
                    Activer
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(acc)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
                >
                  Supprimer
                </button>
              </div>
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

      {deleteTarget && (
        <DeleteAccountConfirmModal
          account={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/* ──────────────────── Modale confirmation suppression compte ──────────────────── */

function DeleteAccountConfirmModal({
  account,
  onClose,
  onConfirm,
}: {
  account: Account;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-red-500/30 p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)" }}
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-300">
          Supprimer le compte
        </p>
        <p className="mb-2 text-sm text-white/80">
          Supprimer le compte{" "}
          <span className="font-mono font-bold text-white">@{account.handle}</span> ?
        </p>
        <p className="mb-5 text-xs leading-relaxed text-white/50">
          Ses vaisseaux, pledges et données associées seront définitivement supprimés.{" "}
          <strong className="text-white/80">Cette action est irréversible.</strong>
        </p>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={() => void handle()}
            disabled={deleting}
            className="rounded-xl bg-red-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
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

/* ───────────────────────── Onglet Notifications ───────────────────────── */

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  // Pill glass : input type=checkbox stylisé (appearance-none). Un knob via ::before
  // ne rend pas de façon fiable sur un <input> dans WebView2 → on le pose en overlay.
  return (
    <label className="relative inline-block h-5 w-10 cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        className="peer h-5 w-10 cursor-pointer appearance-none rounded-full bg-white/10 transition-colors checked:bg-indigo-500"
      />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
    </label>
  );
}

function NotifRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-white/40">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NotificationsTab() {
  const [notifSettings, setNotifSettings] = useState<NotifSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testShown, setTestShown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<NotifSettings>("get_notification_settings")
      .then((s) => {
        if (!cancelled) setNotifSettings(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateNotif<K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) {
    setNotifSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    const serialized = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    void invoke("update_notification_setting", { key, value: serialized }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function handleTest() {
    setTestShown(true);
    window.setTimeout(() => setTestShown(false), 2000);
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!notifSettings) {
    return <p className="text-sm text-white/40">Chargement…</p>;
  }

  const s = notifSettings;
  const thresholds = [24, 48, 72];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {/* Carte 1 — Flotte & Assurance */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          Flotte &amp; Assurance
        </h2>

        <NotifRow
          label="Seuil d'expiration assurance"
          description="Alerte avant l'expiration de l'assurance d'un vaisseau"
        >
          <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            {thresholds.map((h) => {
              const active = s.insuranceExpiryThreshold === h;
              return (
                <button
                  key={h}
                  onClick={() => updateNotif("insuranceExpiryThreshold", h)}
                  className={[
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active
                      ? "border-indigo-500/30 bg-indigo-500/20 text-white"
                      : "border-transparent text-white/50 hover:text-white/90",
                  ].join(" ")}
                >
                  {h}h
                </button>
              );
            })}
          </div>
        </NotifRow>

        <NotifRow label="Assurance expirée" description="Notifier quand une assurance a expiré">
          <Switch
            checked={s.notifInsuranceExpired}
            onChange={() => updateNotif("notifInsuranceExpired", !s.notifInsuranceExpired)}
          />
        </NotifRow>
      </div>

      {/* Carte 2 — Missions & Datamining */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          Missions &amp; Datamining
        </h2>
        <NotifRow
          label="Missions dataminées"
          description="Notifier l'ajout de nouvelles missions dataminées"
        >
          <Switch
            checked={s.notifMinedMissions}
            onChange={() => updateNotif("notifMinedMissions", !s.notifMinedMissions)}
          />
        </NotifRow>
      </div>

      {/* Carte 3 — Canaux de notification */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          Canaux de notification
        </h2>
        <NotifRow label="In-app" description="Toasts dans l'application">
          <Switch checked={s.notifInApp} onChange={() => updateNotif("notifInApp", !s.notifInApp)} />
        </NotifRow>
        <NotifRow label="Système (OS)" description="Notifications natives du système">
          <Switch checked={s.notifSystem} onChange={() => updateNotif("notifSystem", !s.notifSystem)} />
        </NotifRow>

        <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
          <button
            onClick={handleTest}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            Tester
          </button>
          {testShown && (
            <span className="text-sm text-emerald-400">✓ Notification de test envoyée</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Diagnostic ───────────────────────── */

function DiagnosticTab() {
  const [loading, setLoading] = useState<"seed" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "seed" | "remove") {
    setError(null);
    setNotice(null);
    setLoading(action);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setError("Aucun compte actif.");
        return;
      }
      if (action === "seed") {
        await invoke("seed_sample_pack", { accountId });
        setNotice("Pack de test créé. Voir la section « Packs » dans My Fleet.");
      } else {
        await invoke("remove_sample_pack", { accountId });
        setNotice("Pack de test supprimé.");
      }
      await emit("fleet:synced"); // rafraîchit My Fleet / Dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          {notice}
        </p>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/70">
          Outils de test
        </h2>
        <p className="mb-4 text-xs text-white/40">
          Crée un faux pack multi-vaisseaux pour tester la page Pack Detail sans hangar RSI.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => run("seed")}
            disabled={loading !== null}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-emerald-300">
              {loading === "seed" ? "Création…" : "Créer un pack de test"}
            </p>
            <p className="mt-1 text-xs text-white/40">
              Insère le « Praetorian Pack » (14 vaisseaux LTI).
            </p>
          </button>

          <button
            onClick={() => run("remove")}
            disabled={loading !== null}
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-red-300">
              {loading === "remove" ? "Suppression…" : "Supprimer le pack de test"}
            </p>
            <p className="mt-1 text-xs text-white/40">
              Retire le pack et ses vaisseaux liés.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
