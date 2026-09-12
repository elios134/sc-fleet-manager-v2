import logo from "../../../assets/logo.png";

/* ─────────────────────────── État vide (logo en gros) ─────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <img
        src={logo}
        alt="SC Fleet Manager"
        className="w-44 select-none opacity-90"
        draggable={false}
      />
    </div>
  );
}

export { EmptyState };
