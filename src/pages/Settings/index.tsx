import { useTranslation } from "react-i18next";
import { Section } from "./components/Section";
import { LanguageTab } from "./sections/LanguageTab";
import { ComptesTab } from "./sections/ComptesTab";
import { HudTab } from "./sections/HudTab";
import { DonneesTab } from "./sections/DonneesTab";
import { NotificationsTab } from "./sections/NotificationsTab";
import { DataminingTab } from "./sections/DataminingTab";
import { AProposTab } from "./sections/AProposTab";
import { DiagnosticTab } from "./sections/DiagnosticTab";

export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t("settings.page.title")}</h1>
        <p className="mt-1 text-sm text-white/50">{t("settings.page.subtitle")}</p>
      </header>

      {/* Page unique scrollable : sections en encarts titrés, sur 2 colonnes (responsive). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          className="lg:col-span-2"
          title={t("settings.langue.sectionTitle")}
          subtitle={t("settings.langue.sectionSubtitle")}
        >
          <LanguageTab />
        </Section>
        <Section
          className="lg:col-span-2"
          title={t("settings.comptes.sectionTitle")}
          subtitle={t("settings.comptes.sectionSubtitle")}
        >
          <ComptesTab />
        </Section>
        <Section
          title={t("settings.hud.sectionTitle")}
          subtitle={t("settings.hud.sectionSubtitle")}
        >
          <HudTab />
        </Section>
        <Section
          title={t("settings.donnees.sectionTitle")}
          subtitle={t("settings.donnees.sectionSubtitle")}
        >
          <DonneesTab />
        </Section>
        <Section
          title={t("settings.notif.sectionTitle")}
          subtitle={t("settings.notif.sectionSubtitle")}
        >
          <NotificationsTab />
        </Section>
        <Section
          className="lg:col-span-2"
          title={t("settings.datamining.sectionTitle")}
          subtitle={t("settings.datamining.sectionSubtitle")}
        >
          <DataminingTab />
        </Section>
        <Section
          title={t("settings.apropos.sectionTitle")}
          subtitle={t("settings.apropos.sectionSubtitle")}
        >
          <AProposTab />
        </Section>
        {/* Diagnostic : uniquement en DEV (absent du build release, pas juste masqué). */}
        {import.meta.env.DEV && (
          <Section
            title={t("settings.diagnostic.sectionTitle")}
            subtitle={t("settings.diagnostic.sectionSubtitle")}
          >
            <DiagnosticTab />
          </Section>
        )}
      </div>
    </div>
  );
}
