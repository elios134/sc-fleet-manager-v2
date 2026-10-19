import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { NotifSettings } from "../types";
import { SettingRow, SettingsCard } from "../components/SettingRow";
import { Toggle } from "../components/Toggle";
import { Segmented } from "../components/Segmented";

const THRESHOLDS = ["24", "48", "72"] as const;

/* Panneau Notifications : où les recevoir (in-app, système, test) et quoi surveiller. */
export function NotificationsPanel() {
  const { t } = useTranslation();
  const [s, setS] = useState<NotifSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testShown, setTestShown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<NotifSettings>("get_notification_settings")
      .then((v) => !cancelled && setS(v))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
    const serialized = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    void invoke("update_notification_setting", { key, value: serialized }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function test() {
    void invoke("send_test_notification")
      .then(() => {
        setTestShown(true);
        window.setTimeout(() => setTestShown(false), 2500);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  if (error) return <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>;
  if (!s) return <p className="text-sm text-white/40">{t("settings.notif.loading")}</p>;

  const flag = (key: "notifInApp" | "notifSystem" | "notifInsuranceExpired" | "autoPatchDetect" | "notifMinedMissions" | "notifTranslationUpdate", label: string) => (
    <Toggle checked={s[key]} onChange={() => update(key, !s[key])} label={label} />
  );

  return (
    <>
      <SettingsCard
        title={t("settings.notif.cardChannels")}
        action={
          <span className="flex items-center gap-2.5">
            {testShown && <span className="text-xs text-emerald-300">{t("settings.notif.testSent")}</span>}
            <button type="button" onClick={test} className="rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10">
              {t("settings.notif.testBtn")}
            </button>
          </span>
        }
      >
        <SettingRow title={t("settings.notif.inAppLabel")} description={t("settings.notif.inAppDesc")}>{flag("notifInApp", t("settings.notif.inAppLabel"))}</SettingRow>
        <SettingRow title={t("settings.notif.systemLabel")} description={t("settings.notif.systemDesc")}>{flag("notifSystem", t("settings.notif.systemLabel"))}</SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.notif.cardWatch")}>
        <SettingRow title={t("settings.notif.thresholdLabel")} description={t("settings.notif.thresholdDesc")}>
          <Segmented
            label={t("settings.notif.thresholdLabel")}
            value={String(s.insuranceExpiryThreshold) as (typeof THRESHOLDS)[number]}
            onChange={(v) => update("insuranceExpiryThreshold", Number(v))}
            options={THRESHOLDS.map((h) => ({ value: h, label: `${h} h` }))}
          />
        </SettingRow>
        <SettingRow title={t("settings.notif.insuranceExpiredLabel")} description={t("settings.notif.insuranceExpiredDesc")}>
          {flag("notifInsuranceExpired", t("settings.notif.insuranceExpiredLabel"))}
        </SettingRow>
        <SettingRow title={t("settings.notif.newPatchLabel")} description={t("settings.notif.newPatchDesc")}>{flag("autoPatchDetect", t("settings.notif.newPatchLabel"))}</SettingRow>
        <SettingRow title={t("settings.notif.minedMissionsLabel")} description={t("settings.notif.minedMissionsDesc")}>
          {flag("notifMinedMissions", t("settings.notif.minedMissionsLabel"))}
        </SettingRow>
        <SettingRow title={t("settings.notif.translationUpdateLabel")} description={t("settings.notif.translationUpdateDesc")}>
          {flag("notifTranslationUpdate", t("settings.notif.translationUpdateLabel"))}
        </SettingRow>
      </SettingsCard>
    </>
  );
}
