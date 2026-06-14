import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { ChevronDown } from "lucide-react";
import { AddAccountModal } from "./AddAccountModal";

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
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(
    () =>
      Promise.all([
        invoke<string | null>("get_active_account_id"),
        invoke<Account[]>("get_accounts"),
      ])
        .then(([active, list]) => {
          setActiveId(active);
          setAccounts(list);
        })
        .catch(() => {
          /* silencieux : le header reste affiché avec "—" */
        }),
    [],
  );

  useEffect(() => {
    void refresh();
    // Recharge quand un compte est modifié/ajouté (Réglages ou modale d'ajout).
    const un = listen("account:updated", () => void refresh());
    return () => {
      void un.then((f) => f());
    };
  }, [refresh]);

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
      await emit("account:switched"); // la cloche (et autres) se recalent sur le compte actif
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
    // Ancre de largeur nulle, centrée dans la barre : le bloc englobant s'y superpose.
    <div className="relative h-9">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      {/* Bloc englobant unique : chip + menu, grandit vers le bas sans cassure. */}
      <div
        className="absolute left-1/2 top-0 z-50 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.9)" }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-full items-center justify-center gap-2 px-3 text-sm text-white/90 transition-colors hover:bg-white/5"
        >
          {Avatar}
          <span className="font-medium">{activeAccount.handle}</span>
          <ChevronDown
            className={[
              "h-4 w-4 text-white/40 transition-transform",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>

        {open && (
          <div className="min-w-[14rem] border-t border-white/10 p-1">
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
            <button
              onClick={() => {
                setOpen(false);
                setAddOpen(true);
              }}
              className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--accent)] transition-colors hover:bg-white/10"
            >
              + Ajouter un compte
            </button>
          </div>
        )}
      </div>

      {addOpen && (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            // create_account auto-active le nouveau compte.
            await refresh();
            await emit("account:switched"); // cloche & co. se recalent sur le nouvel actif
            setAddOpen(false);
            navigate("/fleet");
          }}
        />
      )}
    </div>
  );
}

export default AccountSwitcher;
