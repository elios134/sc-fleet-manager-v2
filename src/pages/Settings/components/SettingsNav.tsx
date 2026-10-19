import { useTranslation } from "react-i18next";
import { Bell, Database, Gamepad2, Info, Palette, User, Wrench, type LucideIcon } from "lucide-react";
import { SECTIONS, type SectionKey } from "../sections";
import type { Tone } from "../status";

const ICON: Record<SectionKey, LucideIcon> = {
  compte: User, apparence: Palette, donnees: Database, jeu: Gamepad2, notifs: Bell, apropos: Info, diagnostic: Wrench,
};
const PILL: Record<Tone, string> = {
  ok: "bg-emerald-400/15 text-emerald-300",
  warn: "bg-[var(--amber-muted)] text-amber-200",
  off: "bg-white/[0.08] text-white/50",
};

/** Navigation des sections (groupes Moi / App) ; pastille d'état à droite de certaines entrées. */
export function SettingsNav({
  current,
  pills,
  dev,
  onSelect,
}: {
  current: SectionKey;
  pills: Partial<Record<SectionKey, { label: string; tone: Tone }>>;
  dev: boolean;
  onSelect: (k: SectionKey) => void;
}) {
  const { t } = useTranslation();
  const shown = SECTIONS.filter((s) => !s.devOnly || dev);
  return (
    <nav aria-label={t("settings.nav.label")} className="glass flex gap-0.5 overflow-x-auto rounded-2xl p-2 lg:sticky lg:top-0 lg:flex-col lg:overflow-visible">
      {shown.map((s, i) => {
        const Icon = ICON[s.key];
        const pill = pills[s.key];
        const active = s.key === current;
        return (
          <div key={s.key} className="contents">
            {(i === 0 || shown[i - 1].group !== s.group) && (
              <p className="mx-2.5 mb-1 mt-2.5 hidden text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/30 lg:block">
                {t(`settings.group.${s.group}`)}
              </p>
            )}
            <button
              type="button"
              aria-current={active}
              onClick={() => onSelect(s.key)}
              className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[11px] px-2.5 py-2 text-left text-[13.5px] ${
                active ? "bg-[var(--accent-muted)] text-white shadow-[inset_2px_0_0_var(--accent)]" : "text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-[17px] w-[17px] shrink-0 opacity-85" />
              {t(s.labelKey)}
              {pill && <span className={`ml-auto hidden rounded-full px-1.5 text-[10px] font-bold lg:inline ${PILL[pill.tone]}`}>{pill.label}</span>}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
