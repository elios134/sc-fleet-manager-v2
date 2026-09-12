import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

function Header({ right }: { right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t('ccu.eyebrow')}</p>
        <h1 className="text-2xl font-bold text-white">{t('ccu.title')}</h1>
      </div>
      {right}
    </header>
  );
}

export { Header };
