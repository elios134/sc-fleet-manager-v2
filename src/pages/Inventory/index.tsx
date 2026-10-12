import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { InventoryStatus } from "./types";

export default function InventoryPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<InventoryStatus | null>(null);
  useEffect(() => {
    invoke<InventoryStatus>("inventory_status").then(setStatus).catch(() => setStatus(null));
  }, []);
  const frais = status?.derniereTrace != null && Date.now() / 1000 - status.derniereTrace < 600;
  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <header className="flex shrink-0 flex-wrap items-baseline gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("inventory.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("inventory.title")}</h1>
        <span className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-white/55">
          <span className={`h-[7px] w-[7px] rounded-full ${frais ? "bg-emerald-400" : "bg-white/40"}`} />
          {frais ? t("inventory.trackingActive") : t("inventory.trackingWaiting")}
        </span>
      </header>
      {/* sélecteurs + liste branchés en Task 12 */}
    </div>
  );
}
