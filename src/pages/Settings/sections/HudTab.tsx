import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { applyAccent, DEFAULT_ACCENT, DEFAULT_ANIMATIONS, DEFAULT_HUD_INTENSITY, type AppSettings } from "../../../hooks/useAppSettings";
import { MANUFACTURER_THEMES } from "../../../constants/manufacturerThemes";
import { isEnabled as autostartIsEnabled, enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import { useTranslation } from "react-i18next";

function HudTab() {
  const { t } = useTranslation();
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [animations, setAnimations] = useState(DEFAULT_ANIMATIONS === 1);
  const [hudIntensity, setHudIntensity] = useState(DEFAULT_HUD_INTENSITY);
  const [animatedStars, setAnimatedStars] = useState(true);
  // Lancement auto : état OS (login item), pas en base. null = chargement.
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État réel du login item OS au montage.
  useEffect(() => {
    let cancelled = false;
    autostartIsEnabled()
      .then((v) => {
        if (!cancelled) setAutoLaunch(v);
      })
      .catch(() => {
        if (!cancelled) setAutoLaunch(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("get_app_settings")
      .then((s) => {
        if (cancelled || !s) return;
        if (typeof s.accentColor === "string") setAccentColor(s.accentColor);
        if (typeof s.animationsEnabled === "number") setAnimations(s.animationsEnabled === 1);
        if (typeof s.hudGlowIntensity === "number") setHudIntensity(s.hudGlowIntensity);
        if (typeof s.animatedStarsBg === "number") setAnimatedStars(s.animatedStarsBg === 1);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: string, value: string) {
    try {
      await invoke("update_app_settings", { key, value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onAccentChange(value: string) {
    setAccentColor(value);
    applyAccent(value);
    void save("accentColor", value);
  }

  function onAnimationsChange(checked: boolean) {
    setAnimations(checked);
    void save("animationsEnabled", checked ? "1" : "0");
  }

  function onIntensityChange(value: number) {
    setHudIntensity(value);
    void save("hudGlowIntensity", value.toString());
  }

  function onAnimatedStarsChange(checked: boolean) {
    setAnimatedStars(checked);
    void save("animatedStarsBg", checked ? "1" : "0");
    void emit("hud:stars-changed", checked); // Layout (StarsLayer) applique en direct
  }

  // Lancement auto : agit sur le login item OS (pas la base). En cas d'échec, on
  // remet le toggle sur l'état réel de l'OS (re-lecture isEnabled).
  async function onAutoLaunchChange(checked: boolean) {
    setAutoLaunch(checked); // optimiste
    setError(null);
    try {
      if (checked) await autostartEnable();
      else await autostartDisable();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        setAutoLaunch(await autostartIsEnabled());
      } catch {
        setAutoLaunch(false);
      }
    }
  }

  function reset() {
    onAccentChange(DEFAULT_ACCENT);
    onAnimationsChange(DEFAULT_ANIMATIONS === 1);
    onIntensityChange(DEFAULT_HUD_INTENSITY);
    onAnimatedStarsChange(true);
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {/* Thèmes constructeurs (presets d'accent → reteinte toute la DA) */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="font-medium text-white">{t("settings.hud.themesTitle")}</p>
          <p className="mb-3 text-sm text-white/50">{t("settings.hud.themesDesc")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MANUFACTURER_THEMES.map((theme) => {
              const active = accentColor.toLowerCase() === theme.color.toLowerCase();
              return (
                <button
                  key={theme.id}
                  onClick={() => onAccentChange(theme.color)}
                  className={[
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "bg-white/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10",
                  ].join(" ")}
                  style={active ? { borderColor: theme.color } : undefined}
                >
                  <span
                    className="h-7 w-7 shrink-0 rounded-full"
                    style={{
                      background: theme.color,
                      boxShadow: `0 0 10px color-mix(in oklab, ${theme.color} 55%, transparent)`,
                    }}
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: active ? theme.color : "#fff" }}
                    >
                      {theme.name}
                    </p>
                    <p className="truncate text-xs text-white/40">{theme.flavor}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Couleur d'accent (picker libre — preset = raccourci) */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.accentTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.accentDesc")}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/60">{accentColor}</span>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => onAccentChange(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
          </div>
        </div>

        {/* Animations */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.animationsTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.animationsDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={animations}
            onClick={() => onAnimationsChange(!animations)}
            className={[
              "relative h-6 w-11 rounded-full transition-colors",
              animations ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                animations ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Fond étoilé */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.starsTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.starsDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={animatedStars}
            onClick={() => onAnimatedStarsChange(!animatedStars)}
            className={[
              "relative h-6 w-11 rounded-full transition-colors",
              animatedStars ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                animatedStars ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Intensité HUD */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">{t("settings.hud.intensityTitle")}</p>
              <p className="text-sm text-white/50">{t("settings.hud.intensityDesc")}</p>
            </div>
            <span className="text-sm text-white/60">{hudIntensity}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={hudIntensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        {/* Lancement automatique (état OS, pas en base) */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.autoLaunchTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.autoLaunchDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={autoLaunch ?? false}
            disabled={autoLaunch === null}
            onClick={() => void onAutoLaunchChange(!(autoLaunch ?? false))}
            className={[
              "relative h-6 w-11 rounded-full transition-colors disabled:opacity-50",
              autoLaunch ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                autoLaunch ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        <button
          onClick={reset}
          className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          {t("settings.hud.resetBtn")}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Notifications ───────────────────────── */

export { HudTab };
