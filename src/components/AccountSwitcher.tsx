import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";

type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export function AccountSwitcher() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<string | null>("get_active_account_id"),
      invoke<Account[]>("get_accounts"),
    ])
      .then(([active, list]) => {
        if (cancelled) return;
        setActiveId(active);
        setAccounts(list);
      })
      .catch(() => {
        /* silencieux : le header reste affiché avec "—" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeAccount = accounts.find((a) => String(a.id) === activeId) ?? null;
  const otherAccounts = accounts.filter((a) => String(a.id) !== activeId);
  const activeHandle = activeAccount?.handle ?? null;

  // Portrait RSI du compte actif (AppMeta rsi.portrait.{handle}). Fallback : pastille.
  useEffect(() => {
    if (!activeHandle) {
      setPortrait(null);
      return;
    }
    let cancelled = false;
    invoke<{ portraitUrl: string | null }>("get_rsi_session_status", { handle: activeHandle })
      .then((s) => {
        if (!cancelled) setPortrait(s.portraitUrl);
      })
      .catch(() => {
        /* pas de portrait : on garde la pastille */
      });
    return () => {
      cancelled = true;
    };
  }, [activeHandle]);

  const Avatar = portrait ? (
    <img src={portrait} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
  );

  async function switchTo(id: number) {
    try {
      await invoke("set_active_account", { accountId: String(id) });
      setActiveId(String(id));
      setOpen(false);
      navigate("/fleet");
    } catch {
      setOpen(false);
    }
  }

  // Aucun compte actif : clic direct vers la StartPage.
  if (!activeAccount) {
    return (
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3 text-sm text-white/90 transition-colors hover:bg-white/10"
      >
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
        <span className="font-medium">—</span>
        <ChevronDown className="h-4 w-4 text-white/40" />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3 text-sm text-white/90 transition-colors hover:bg-white/10"
      >
        {Avatar}
        <span className="font-medium">{activeAccount.handle}</span>
        <ChevronDown className="h-4 w-4 text-white/40" />
      </button>

      {open && (
        <>
          {/* Couche de fermeture au clic extérieur */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border backdrop-blur-2xl"
            style={{
              background: "rgba(20,20,28,0.9)",
              borderColor: "var(--card-border)",
            }}
          >
            {otherAccounts.length > 0 && (
              <div className="border-b border-white/10 p-1">
                {otherAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => switchTo(acc.id)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
                  >
                    <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
                    <span className="truncate">{acc.handle}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setOpen(false);
                navigate("/");
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
            >
              Changer de compte
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default AccountSwitcher;
