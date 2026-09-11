

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 font-semibold"
      style={{
        color: ok ? "#34d399" : "#f87171",
        background: ok ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
      }}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/* ───────────────────────── Onglet À propos ───────────────────────── */

export { Badge };
