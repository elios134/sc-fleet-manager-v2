import { useEffect, useState, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";

type UpState = "idle" | "checking" | "available" | "uptodate" | "error" | "downloading" | "ready";

function AProposTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [up, setUp] = useState<UpState>("idle");
  const [upInfo, setUpInfo] = useState<{ version: string; body?: string } | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ouvre dans le navigateur externe (jamais dans la webview de l'app).
  function open(url: string) {
    void openUrl(url).catch(() => {});
  }

  async function checkUpdates() {
    setUp("checking");
    setUpErr(null);
    try {
      const u = await check();
      if (u) {
        updateRef.current = u;
        setUpInfo({ version: u.version, body: u.body });
        setUp("available");
      } else {
        setUp("uptodate");
      }
    } catch (e) {
      // 404 attendu tant qu'aucune release n'est publiée (Étape 4) → état "error", pas de crash.
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  async function downloadInstall() {
    const u = updateRef.current;
    if (!u) return;
    setUp("downloading");
    setPct(0);
    setUpErr(null);
    try {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        } else if (ev.event === "Finished") setPct(100);
      });
      setUp("ready");
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  async function doRelaunch() {
    try {
      await relaunch();
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  const REPO = "https://github.com/elios134/sc-fleet-manager-v2";
  const ONIVOID = "https://github.com/Onivoid";
  const DRCHEWBACCA = "https://www.youtube.com/@Dr-Chewbacca";
  const AGPL = "https://www.gnu.org/licenses/agpl-3.0.html";

  return (
    <div className="space-y-4">
      {/* Identité */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-lg font-bold text-white">SCFM V2</p>
        <p className="mt-0.5 text-sm text-white/50">
          {t("settings.apropos.versionLabel")}{" "}
          <span className="font-mono text-[var(--accent)]">{version ?? "…"}</span>
        </p>
        <p className="mt-2 text-sm text-white/60">
          {t("settings.apropos.authorPrefix")}{" "}
          <span className="font-medium text-white/80">Elios</span>
        </p>
      </div>

      {/* Mises à jour */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.updatesLabel")}
        </p>

        {up !== "downloading" && up !== "ready" && (
          <button
            onClick={() => void checkUpdates()}
            disabled={up === "checking"}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {up === "checking"
              ? t("settings.apropos.checking")
              : t("settings.apropos.checkUpdatesBtn")}
          </button>
        )}

        {up === "uptodate" && (
          <p className="mt-3 text-sm text-emerald-400">
            {t("settings.apropos.upToDate", { version })}
          </p>
        )}

        {up === "error" && (
          <p className="mt-3 text-sm text-white/60">
            {t("settings.apropos.checkError")}
            {upErr && <span className="mt-1 block font-mono text-xs text-white/30">{upErr}</span>}
          </p>
        )}

        {up === "available" && upInfo && (
          <div className="mt-3">
            <p className="text-sm text-white">
              {t("settings.apropos.updateAvailablePrefix")}{" "}
              <span className="font-mono text-[var(--accent)]">v{upInfo.version}</span>{" "}
              {t("settings.apropos.updateAvailableSuffix")}
            </p>
            {upInfo.body && (
              <p className="mt-1 max-h-32 overflow-auto whitespace-pre-line rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/50">
                {upInfo.body}
              </p>
            )}
            <button
              onClick={() => void downloadInstall()}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
              style={{ background: "var(--accent)" }}
            >
              {t("settings.apropos.downloadInstallBtn")}
            </button>
          </div>
        )}

        {up === "downloading" && (
          <div className="mt-1">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/60">{t("settings.apropos.downloading")}</span>
              <span className="font-mono text-[var(--accent)]">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
          </div>
        )}

        {up === "ready" && (
          <div className="mt-1">
            <p className="text-sm text-emerald-400">{t("settings.apropos.updateReady")}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void doRelaunch()}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
                style={{ background: "var(--accent)" }}
              >
                {t("settings.apropos.relaunchNowBtn")}
              </button>
              <button
                onClick={() => setUp("idle")}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
              >
                {t("settings.apropos.laterBtn")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Liens */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.linksLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => open(REPO)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
          >
            {t("settings.apropos.githubRepoBtn")}
          </button>
        </div>
      </div>

      {/* Crédit Multitool */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.creditsLabel")}
        </p>
        <p className="text-sm leading-relaxed text-white/70">
          <button
            onClick={() => open(ONIVOID)}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Multitool
          </button>{" "}
          {t("settings.apropos.creditSuffix")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          <button
            onClick={() => open(DRCHEWBACCA)}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Dr-Chewbacca
          </button>{" "}
          {t("settings.apropos.creditChewbacca")}
        </p>
      </div>

      {/* Licence (AGPL v3) */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.licenseLabel")}
        </p>
        <p className="text-sm leading-relaxed text-white/70">
          {t("settings.apropos.licenseCopyright")}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-white/70">
          {t("settings.apropos.licenseUnderPrefix")}{" "}
          <button
            onClick={() => open(AGPL)}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            GNU AGPL v3
          </button>
        </p>
        <p className="mt-1 text-sm leading-relaxed text-white/70">
          {t("settings.apropos.licenseSourcePrefix")}{" "}
          <button
            onClick={() => open(REPO)}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            {t("settings.apropos.licenseSourceLink")}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Diagnostic ───────────────────────── */

export { AProposTab };
