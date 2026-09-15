import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import type { CatalogShip } from "../types";

const RENTAL_DURATIONS = [1, 3, 7, 30];

/* Modale « Ajouter un vaisseau » : recherche dans le catalogue ShipData + mode acheté/loué
   (durée de location). Logique inchangée depuis la V1. */
export default function AddShipModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (shipDataId: number, mode: "bought" | "rented", rentalDays?: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogShip[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CatalogShip | null>(null);
  const [mode, setMode] = useState<"bought" | "rented">("bought");
  const [rentalDays, setRentalDays] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<CatalogShip[]>("get_all_ship_data")
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = search
    ? catalog.filter((s) => {
        const q = search.toLowerCase();
        return s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q);
      })
    : catalog;

  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onAdd(selected.id, mode, mode === "rented" ? rentalDays : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("fleet.addShipTitle")} onClose={onClose} size="lg" bodyClassName="">
      <div className="border-b border-white/10 p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("fleet.addShipSearch")}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
        />
        <div className="mt-3 grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {filtered.slice(0, 200).map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className={[
                "flex items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                selected?.id === s.id ? "border-accent/70 bg-accent/10" : "border-white/10 bg-white/[0.03] hover:border-accent/30",
              ].join(" ")}
            >
              {s.imageUrl ? (
                <img src={s.imageUrl} alt="" className="h-9 w-12 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-9 w-12 shrink-0 rounded bg-white/5" />
              )}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-white">{s.name}</div>
                <div className="truncate text-[11px] text-white/40">{s.manufacturer}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          {(["bought", "rented"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={[
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                mode === m ? "border-accent/60 bg-accent/10 text-accent" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
              ].join(" ")}
            >
              {m === "bought" ? t("fleet.modeBought") : t("fleet.modeRented")}
            </button>
          ))}
        </div>

        {mode === "rented" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">{t("fleet.rentalDuration")}</span>
            {RENTAL_DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setRentalDays(d)}
                className={[
                  "rounded-md border px-3 py-1 text-xs font-semibold transition-colors",
                  rentalDays === d ? "border-blue-400/60 bg-blue-400/10 text-blue-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                ].join(" ")}
              >
                {t("fleet.daysShort", { days: d })}
              </button>
            ))}
          </div>
        )}

        <Button onClick={() => void confirm()} disabled={!selected || busy} className="mt-1">
          {busy ? "…" : selected ? t("fleet.addShipConfirm", { name: selected.name }) : t("fleet.addShipPick")}
        </Button>
      </div>
    </Modal>
  );
}
