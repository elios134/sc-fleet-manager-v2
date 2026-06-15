import { Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

// Barre de titre custom GLOBALE (fenêtre decorations:false). Rendue une seule fois
// au niveau racine (App), au-dessus du routeur → présente sur TOUTES les routes,
// StartPage incluse. Zone draggable (data-tauri-drag-region) hors boutons. Le bouton
// Fermer appelle close(), qui déclenche CloseRequested → interception Rust
// (prevent_close + hide) = minimise en tray (Lot F), PAS un vrai quit.
export function TitleBar() {
  const win = getCurrentWindow();
  const { t } = useTranslation();
  return (
    <div
      data-tauri-drag-region
      className="relative z-40 flex h-8 shrink-0 select-none items-center justify-between pl-3 pr-1"
    >
      <span data-tauri-drag-region className="text-xs font-semibold tracking-[0.2em] text-white/40">
        SCFM
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => void win.minimize()}
          title={t("titlebar.minimize")}
          aria-label={t("titlebar.minimize")}
          className="flex h-6 w-9 items-center justify-center rounded text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={() => void win.close()}
          title={t("titlebar.closeToTray")}
          aria-label={t("titlebar.close")}
          className="flex h-6 w-9 items-center justify-center rounded text-white/55 transition-colors hover:bg-red-500/80 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
