import { useTranslation } from "react-i18next";
import Modal from "../../../components/ui/Modal";

/* Confirmation quand le user.cfg du canal pointe déjà vers une AUTRE langue. */
export function ConflictModal({
  channel,
  current,
  packName,
  onCancel,
  onConfirm,
}: {
  channel: string;
  current: string;
  packName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      onClose={onCancel}
      size="sm"
      title={t("translation.conflictTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-[10px] px-3 py-2 text-[12.5px] font-semibold text-white/55 hover:text-white">
            {t("translation.cancel")}
          </button>
          <button type="button" onClick={onConfirm} className="rounded-[10px] bg-[var(--accent)] px-3 py-2 text-[12.5px] font-semibold text-white">
            {t("translation.conflictConfirm")}
          </button>
        </div>
      }
    >
      <p className="text-[13px] leading-relaxed text-white/60">
        {t("translation.conflictBody", { channel, current, pack: packName })}
      </p>
    </Modal>
  );
}
