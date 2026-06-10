import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';

type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export default function StartPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<Account[]>('get_accounts')
      .then((data) => {
        if (!cancelled) setAccounts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectAccount(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('set_active_account', { accountId: String(id) });
      navigate('/fleet');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<Account>('create_account', {
        handle: trimmed,
        displayName: displayName.trim() || null,
      });
      navigate('/fleet');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-auto p-8">
      {/* Fond glassmorphique (cohérent avec le Layout, StartPage est hors layout) */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.10) 0%, transparent 50%), #0a0a0f',
        }}
      />

      <div className="relative z-10 w-full max-w-2xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-[0.2em] text-white">RSI TERMINAL</h1>
          <p className="mt-2 text-sm text-white/50">Sélectionnez votre commandant</p>
        </header>

        {error && (
          <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {/* Grille de comptes existants */}
        {accounts.length > 0 && (
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {accounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => selectAccount(acc.id)}
                disabled={busy}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white">{acc.handle}</span>
                  {acc.displayName && (
                    <span className="block truncate text-sm text-white/50">{acc.displayName}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Création d'un nouveau compte */}
        <form
          onSubmit={handleCreate}
          className="rounded-2xl border border-white/10 bg-white/5 p-5"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
            Nouveau compte
          </h2>
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
      </div>
    </div>
  );
}
