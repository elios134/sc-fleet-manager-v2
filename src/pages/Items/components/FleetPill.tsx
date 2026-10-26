import { useTranslation } from "react-i18next";

/** Pastille « dans ta flotte / pas dans ta flotte » ; rien si la flotte n'a pas pu être lue. */
export function FleetPill({ owned }: { owned: boolean | null }) {
  const { t } = useTranslation();
  if (owned == null) return null;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${owned ? "border-emerald-400/40 text-emerald-300" : "border-[var(--amber)]/45 text-[var(--amber)]"}`}>
      {t(owned ? "items.inFleet" : "items.notInFleet")}
    </span>
  );
}
