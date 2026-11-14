import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../../../components/ui/Modal";
import Dropdown from "../../../components/ui/Dropdown";
import Button from "../../../components/ui/Button";
import type { FactionRep } from "../../../lib/reputation";

/** « Corriger mon rang » : rang réel + réputation dans ce rang, à partir de maintenant. */
export function CorrectRankModal({
  f,
  onSave,
  onReset,
  onClose,
}: {
  f: FactionRep;
  onSave: (rankIndex: number, repInRank: number) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rank, setRank] = useState(String(f.declared?.rankIndex ?? f.rankIndex));
  const [rep, setRep] = useState(String(f.declared?.repInRank ?? 0));
  const [busy, setBusy] = useState(false);
  const repNum = Number(rep);
  const valid = Number.isInteger(repNum) && repNum >= 0;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={t("reputation.correctTitle", { faction: f.faction })}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {f.rankSource === "declared" && (
            <Button variant="secondary" disabled={busy} onClick={() => void run(onReset)}>
              {t("reputation.correctReset")}
            </Button>
          )}
          <Button className="ml-auto" disabled={busy || !valid} onClick={() => void run(() => onSave(Number(rank), repNum))}>
            {t("reputation.correctSave")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-white/60">{t("reputation.correctHint")}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">{t("reputation.correctRank")}</span>
          <Dropdown value={rank} onChange={setRank} options={f.ranks.map((r, i) => ({ value: String(i), label: r.name }))} ariaLabel={t("reputation.correctRank")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">{t("reputation.correctRep")}</span>
          <input
            type="number"
            min={0}
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            className="rounded-[10px] border border-white/15 bg-[var(--surface-input)] px-3 py-2 tabular-nums text-white outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>
    </Modal>
  );
}
