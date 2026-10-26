import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { BACKGROUNDS, DEFAULT_BACKGROUND, VORTEX, backgroundById } from "../../../components/background/themes/backgrounds";
import { VORTEX_IMAGE } from "../../../components/background/themes/images";

// Vignette du Ciel étoilé (pas d'image) : fond teinté de l'app et quelques étoiles.
const STARS_PREVIEW =
  "radial-gradient(1px 1px at 18% 30%, rgba(255,255,255,.7), transparent), radial-gradient(1px 1px at 62% 22%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 80% 64%, rgba(255,255,255,.6), transparent), radial-gradient(1px 1px at 36% 72%, rgba(255,255,255,.45), transparent), radial-gradient(1px 1px at 50% 46%, rgba(255,255,255,.55), transparent), radial-gradient(ellipse at 20% 50%, var(--bg-glow-1, rgba(99,102,241,0.15)) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, var(--bg-glow-2, rgba(139,92,246,0.10)) 0%, transparent 50%), #0a0a0f";

/** Galerie des fonds : un clic applique le fond (AppMeta ui.background + événement → Layout). */
export function BackgroundGallery({ paused }: { paused: boolean }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(DEFAULT_BACKGROUND);

  useEffect(() => {
    let cancelled = false;
    invoke<string | null>("get_app_meta", { key: "ui.background" })
      .then((v) => !cancelled && v && setCurrent(backgroundById(v).id))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function pick(id: typeof current) {
    setCurrent(id);
    void emit("hud:background-changed", id);
    void invoke("set_app_meta", { key: "ui.background", value: id }).catch(() => {});
  }

  return (
    <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t("settings.hud.bgGallery")}>
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
              {b.id === "vortex" ? (
                <img
                  src={VORTEX_IMAGE}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  style={{ objectPosition: `${VORTEX.focus[0] * 100}% ${(1 - VORTEX.focus[1]) * 100}%` }}
                />
              ) : (
                <span className="block h-full w-full" style={{ background: STARS_PREVIEW }} />
              )}
              {active && paused && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 text-[9.5px] text-white/80">{t("settings.hud.bgPaused")}</span>
              )}
            </span>
            <span className="flex flex-col gap-0.5 bg-white/[0.03] px-2.5 py-1.5">
              <b className="truncate text-[12px] text-white">{t(b.nameKey)}</b>
              <small className="truncate text-[10.5px] text-white/45">{t(b.hintKey)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
