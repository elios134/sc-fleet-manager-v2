import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { BACKGROUNDS, DEFAULT_BACKGROUND } from "../../../components/background/themes/backgrounds";
import { BACKGROUND_IMAGES } from "../../../components/background/themes/images";

/** Galerie des fonds : un clic applique le fond (AppMeta ui.background + événement → Layout). */
export function BackgroundGallery({ paused }: { paused: boolean }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(DEFAULT_BACKGROUND);

  useEffect(() => {
    let cancelled = false;
    invoke<string | null>("get_app_meta", { key: "ui.background" })
      .then((v) => !cancelled && v && setCurrent(v))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function pick(id: string) {
    setCurrent(id);
    void emit("hud:background-changed", id);
    void invoke("set_app_meta", { key: "ui.background", value: id }).catch(() => {});
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="radiogroup" aria-label={t("settings.hud.bgGallery")}>
      {BACKGROUNDS.map((b) => {
        const active = b.id === current;
        return (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(b.id)}
            className={`flex flex-col overflow-hidden rounded-xl border text-left ${active ? "border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]" : "border-white/10 hover:border-white/25"}`}
          >
            <span className="relative block h-[72px] w-full">
              <img
                src={BACKGROUND_IMAGES[b.id]}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                style={{ objectPosition: `${b.focus[0] * 100}% ${(1 - b.focus[1]) * 100}%` }}
              />
              {active && paused && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 text-[9.5px] text-white/80">{t("settings.hud.bgPaused")}</span>
              )}
            </span>
            <span className="flex flex-col gap-0.5 bg-white/[0.03] px-2.5 py-1.5">
              <b className="truncate text-[12px] text-white">{t(b.nameKey)}</b>
              <small className="truncate text-[10.5px] text-white/45">
                {b.author ? t("settings.hud.bgBy", { author: b.author }) : t("settings.hud.bgSwirl")}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
