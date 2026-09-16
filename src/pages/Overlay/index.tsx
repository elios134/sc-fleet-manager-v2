import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";
import { PhysicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useTranslation } from "react-i18next";
import {
  createOverlayDefaults,
  enableManualPositioning,
  normalizeOverlaySettings,
  type OverlaySettings,
} from "../../lib/overlayPreferences";
import OverlayConfig from "./components/OverlayConfig";
import OverlayPreview from "./components/OverlayPreview";

/* Page « Overlay » — configuration de l'overlay in-game + aperçu live du HUD.
   L'état des réglages vit ici pour alimenter simultanément le panneau de config
   (gauche) et l'aperçu (droite). Persisté en AppMeta « overlay.settings », appliqué
   à la fenêtre réelle via l'événement « overlay:settings-changed ». */

export default function OverlayPage() {
  const { t } = useTranslation();
  const [s, setS] = useState<OverlaySettings>(createOverlayDefaults);

  useEffect(() => {
    const load = async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.settings" }).catch(() => null);
      if (!raw) return;
      try {
        setS(normalizeOverlaySettings(JSON.parse(raw)));
      } catch {
        /* défaut conservé */
      }
    };
    void load();
    const un = listen("overlay:settings-changed", () => void load());
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const persist = useCallback((next: OverlaySettings) => {
    void invoke("set_app_meta", { key: "overlay.settings", value: JSON.stringify(next) }).catch(() => {});
    void emit("overlay:settings-changed").catch(() => {});
  }, []);

  const patch = useCallback(
    (p: Partial<OverlaySettings>) =>
      setS((cur) => {
        const next = { ...cur, ...p };
        persist(next);
        return next;
      }),
    [persist],
  );

  const onToggle = () => void invoke("toggle_overlay").catch(() => {});

  const onReposition = () => {
    setS((cur) => {
      const next = enableManualPositioning(cur);
      persist(next);
      return next;
    });
    void invoke("show_overlay").catch(() => {});
  };

  const onReset = async () => {
    void invoke("set_app_meta", { key: "overlay.geom", value: "" }).catch(() => {});
    try {
      const w = await WebviewWindow.getByLabel("overlay");
      if (!w) return;
      await w.setSize(new PhysicalSize(360, 480));
      try {
        const mons = await availableMonitors();
        if (mons.length) await w.setPosition(new PhysicalPosition(mons[0].position.x + 40, mons[0].position.y + 40));
      } catch {
        /* pas de moniteurs */
      }
    } catch {
      /* overlay fermé */
    }
  };

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("overlayPage.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("overlayPage.title")}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/50">{t("overlayPage.desc")}</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <OverlayConfig s={s} patch={patch} onToggle={onToggle} onReposition={onReposition} onReset={() => void onReset()} />

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("overlayPage.previewLabel")}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-[#5dcaa5]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5dcaa5] shadow-[0_0_8px_#5dcaa5]" /> {t("overlayPage.live")}
            </span>
          </div>
          <OverlayPreview s={s} />
          <p className="mt-2 text-[11px] text-white/40">{t("overlayPage.previewHint")}</p>
        </div>
      </div>
    </div>
  );
}
