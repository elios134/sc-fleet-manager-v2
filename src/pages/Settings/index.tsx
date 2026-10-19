import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AccountPanel } from "./panels/AccountPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { DataPanel } from "./panels/DataPanel";
import { NotificationsPanel } from "./panels/NotificationsPanel";
import { GamePanel } from "./panels/GamePanel";
import { AboutPanel } from "./panels/AboutPanel";
import { DiagnosticTab } from "./panels/DiagnosticPanel";
import { SettingsCard } from "./components/SettingRow";
import { SettingsNav } from "./components/SettingsNav";
import { StatusStrip, type StatusItem } from "./components/StatusStrip";
import { sectionFromHash, type SectionKey } from "./sections";
import { accountTone, dataTone } from "./status";
import { useSettingsStatus } from "./useSettingsStatus";
import { useDatamining } from "../../contexts/DataminingContext";

/* Page Paramètres : en-tête + bandeau d'état, navigation par section (dans l'ancre de
   l'URL, ex. /settings#donnees) et panneau de la section active. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const dev = import.meta.env.DEV;
  const current = sectionFromHash(hash, dev);
  const status = useSettingsStatus();
  const { patch } = useDatamining();
  const open = (k: SectionKey) => navigate({ hash: k }, { replace: true });

  const stale = status.data ? status.data.stale + status.data.never : 0;
  const items: StatusItem[] = [
    {
      key: "compte",
      title: status.account?.handle ?? t("settings.status.noAccount"),
      detail: status.account ? (status.account.sessionActive ? t("settings.status.sessionActive") : t("settings.status.sessionOff")) : t("settings.status.addAccount"),
      tone: accountTone(status.account),
    },
    ...(status.data
      ? [{ key: "donnees" as const, title: t("settings.nav.donnees"), detail: stale === 0 ? t("settings.status.dataOk") : t("settings.status.dataStale", { count: stale }), tone: dataTone(status.data) }]
      : []),
    ...(status.gamelog
      ? [{ key: "jeu" as const, title: "Game.log", detail: status.gamelog.enabled ? t("settings.status.gamelogOn") : t("settings.status.gamelogOff"), tone: status.gamelog.enabled ? ("ok" as const) : ("off" as const) }]
      : []),
    ...(status.version ? [{ key: "apropos" as const, title: `v${status.version}`, detail: t("settings.status.version"), tone: "off" as const }] : []),
  ];

  const panels: Record<SectionKey, ReactNode> = {
    compte: <AccountPanel />,
    apparence: <AppearancePanel />,
    donnees: <DataPanel onOpenGame={() => open("jeu")} />,
    jeu: <GamePanel />,
    notifs: <NotificationsPanel />,
    apropos: <AboutPanel />,
    diagnostic: dev ? <SettingsCard title={t("settings.diagnostic.sectionTitle")} hint={t("settings.diagnostic.sectionSubtitle")}><DiagnosticTab /></SettingsCard> : null,
  };

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-6 pb-28 pt-6">
      <header className="flex flex-wrap items-end gap-3.5 [text-shadow:0_2px_16px_rgba(0,0,0,0.7)]">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-white">{t("settings.page.title")}</h1>
          <p className="mt-0.5 text-[13px] text-white/50">{t("settings.page.subtitle")}</p>
        </div>
        <StatusStrip items={items} onOpen={open} />
      </header>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsNav
          current={current}
          dev={dev}
          onSelect={open}
          pills={{
            compte: { label: status.account ? t("settings.status.pillConnected") : t("settings.status.pillNone"), tone: accountTone(status.account) },
            ...(status.data && stale > 0 ? { donnees: { label: t("settings.status.pillStale", { count: stale }), tone: "warn" as const } } : {}),
            ...(patch?.installedChannel ? { jeu: { label: patch.installedChannel, tone: "ok" as const } } : {}),
            ...(status.version ? { apropos: { label: `v${status.version}`, tone: "off" as const } } : {}),
          }}
        />
        {(Object.keys(panels) as SectionKey[]).map((k) =>
          panels[k] ? (
            <div key={k} hidden={k !== current} className="flex min-w-0 flex-col gap-3.5 lg:col-start-2">
              {panels[k]}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
