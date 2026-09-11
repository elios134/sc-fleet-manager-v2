// Ligne « label → valeur » de l'onglet Détails (Description Data). « — » si absente.
function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-[12px]">
      <span className="text-white/40">{label}</span>
      <span className="text-right text-white/85">{value && value !== "" ? value : "—"}</span>
    </div>
  );
}

export { DataRow };
