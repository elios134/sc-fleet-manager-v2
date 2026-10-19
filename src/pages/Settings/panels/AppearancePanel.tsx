import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { applyAccent, DEFAULT_ACCENT, DEFAULT_ANIMATIONS, DEFAULT_HUD_INTENSITY, type AppSettings } from "../../../hooks/useAppSettings";
import { MANUFACTURER_THEMES } from "../../../constants/manufacturerThemes";
import { isEnabled as autostartIsEnabled, enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import jumppoint from "../../../assets/jumppoint.jpg";
import { SettingRow, SettingsCard } from "../components/SettingRow";
import { Toggle } from "../components/Toggle";

/* Panneau Apparence : thèmes constructeurs, accent, fond et effets, démarrage. */
export function AppearancePanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
    void emit("hud:stars-changed", checked); // Layout (BackgroundLayer) applique en direct
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
    <>
      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>}

      <SettingsCard title={t("settings.hud.themesTitle")} hint={t("settings.hud.themesDesc")}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {MANUFACTURER_THEMES.map((theme) => {
            const active = accentColor.toLowerCase() === theme.color.toLowerCase();
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                onClick={() => onAccentChange(theme.color)}
                className={`flex flex-col gap-1.5 rounded-xl border bg-white/[0.03] p-2.5 text-left ${active ? "border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]" : "border-white/10 hover:bg-white/[0.06]"}`}
              >
                <i className="h-[22px] rounded-[7px]" style={{ background: `linear-gradient(135deg, ${theme.color}, color-mix(in oklab, ${theme.color} 35%, #0a0a0f))` }} />
                <b className="text-[11.5px] tracking-[0.06em] text-white">{theme.name}</b>
                <small className="text-[10.5px] text-white/50">{theme.flavor}</small>
              </button>
            );
          })}
        </div>
        <SettingRow title={t("settings.hud.accentTitle")} description={t("settings.hud.accentDesc")}>
          <span className="font-mono text-xs text-white/55">{accentColor}</span>
          <input
            type="color"
            value={accentColor}
            onChange={(e) => onAccentChange(e.target.value)}
            aria-label={t("settings.hud.accentTitle")}
            className="h-8 w-11 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.hud.effectsTitle")}>
        <div className="grid grid-cols-1 items-center gap-3.5 sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="relative h-[84px] overflow-hidden rounded-xl border border-white/10">
            <img src={jumppoint} alt="" className="h-full w-full object-cover" style={{ objectPosition: "51.5% 50%" }} />
            {!animatedStars && (
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 text-[9.5px] text-white/80">{t("settings.hud.bgPaused")}</span>
            )}
          </div>
          <SettingRow title={t("settings.hud.starsTitle")} description={t("settings.hud.starsDesc")}>
            <Toggle checked={animatedStars} onChange={() => onAnimatedStarsChange(!animatedStars)} label={t("settings.hud.starsTitle")} />
          </SettingRow>
        </div>
        <SettingRow title={t("settings.hud.animationsTitle")} description={t("settings.hud.animationsDesc")}>
          <Toggle checked={animations} onChange={() => onAnimationsChange(!animations)} label={t("settings.hud.animationsTitle")} />
        </SettingRow>
        <SettingRow title={t("settings.hud.intensityTitle")} description={t("settings.hud.intensityDesc")}>
          <span className="w-8 text-right text-xs tabular-nums text-white/55">{hudIntensity}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={hudIntensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            aria-label={t("settings.hud.intensityTitle")}
            className="w-40 accent-[var(--accent)]"
          />
        </SettingRow>
        <button type="button" onClick={reset} className="self-start rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white/80 hover:bg-white/10">
          {t("settings.hud.resetBtn")}
        </button>
      </SettingsCard>

      <SettingsCard title={t("settings.hud.startupTitle")}>
        <SettingRow title={t("settings.hud.autoLaunchTitle")} description={t("settings.hud.autoLaunchDesc")}>
          <Toggle checked={autoLaunch ?? false} disabled={autoLaunch === null} onChange={() => void onAutoLaunchChange(!(autoLaunch ?? false))} label={t("settings.hud.autoLaunchTitle")} />
        </SettingRow>
        <SettingRow title={t("settings.hud.pinsTitle")} description={t("settings.hud.pinsDesc")}>
          <button type="button" onClick={() => navigate("/features")} className="rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10">
            {t("settings.hud.pinsBtn")}
          </button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}
