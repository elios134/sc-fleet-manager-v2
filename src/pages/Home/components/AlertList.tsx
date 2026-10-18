import { useTranslation } from "react-i18next";
import type { Alert } from "../home";

const DOT: Record<Alert["severity"], string> = { bad: "bg-red-400", warn: "bg-[var(--amber)]", info: "bg-[var(--accent)]" };

/* Alertes à traiter, chacune avec son bouton d'action (bloc masqué s'il n'y en a aucune). */
export function AlertList({ alerts, onOpen }: { alerts: Alert[]; onOpen: (to: string) => void }) {
  const { t } = useTranslation();
  if (alerts.length === 0) return null;
  return (
    <>
      {alerts.map((a, i) => (
        <div key={`${a.kind}-${i}`} className="glass grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: "rgba(20,20,32,0.34)" }}>
          <span className={`h-2 w-2 rounded-full ${DOT[a.severity]}`} />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-white">{t(`${a.titleKey}Title`, a.params)}</p>
            <p className="truncate text-[11.5px] text-white/45">{t(`${a.titleKey}Body`, a.params)}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpen(a.to)}
            className={`rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-bold ${a.severity === "bad" ? "bg-[var(--accent)] text-white" : "border border-white/15 bg-white/[0.08] text-white/85"}`}
          >
            {t(`home.alertAction.${a.kind}`)}
          </button>
        </div>
      ))}
    </>
  );
}
