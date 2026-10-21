

// Petits blocs d'interface de la grille de soute.

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: "amber" | "green" }) {
  const color = accent === "amber" ? "text-[var(--accent)]" : accent === "green" ? "text-emerald-400" : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.1em] text-white/40">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-white/40">{label}</div>
      {children}
    </div>
  );
}
