import { useEffect, useState, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import logo from "../../../assets/logo.png";
import { BACKGROUNDS } from "../../../components/background/themes/backgrounds";

type UpState = "idle" | "checking" | "available" | "uptodate" | "error" | "downloading" | "ready";

/* Panneau À propos : identité + mises à jour, crédits, licence. */
export function AboutPanel() {
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

  const btn = "rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10 disabled:opacity-50";
  const primary = "rounded-[10px] bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-semibold text-white";
  const link = "font-medium text-[var(--accent)] hover:underline";

  return (
    <>
      <section className="glass flex min-w-0 flex-col gap-3.5 rounded-2xl px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-4">
          <img src={logo} alt="" className="h-16 w-16 rounded-2xl object-contain" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-white">SC Fleet Manager</p>
            <p className="mt-0.5 text-[12.5px] text-white/50">
              {t("settings.apropos.versionLabel")} <span className="font-mono text-white/80">{version ?? "…"}</span> · {t("settings.apropos.authorPrefix")} Elios
            </p>
            {up === "uptodate" && (
              <span className="mt-2 inline-block rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2 text-[10.5px] font-bold text-emerald-300">
                {t("settings.apropos.upToDate", { version })}
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {up !== "downloading" && up !== "ready" && (
              <button type="button" onClick={() => void checkUpdates()} disabled={up === "checking"} className={btn}>
                {up === "checking" ? t("settings.apropos.checking") : t("settings.apropos.checkUpdatesBtn")}
              </button>
            )}
            <button type="button" onClick={() => open(REPO)} className={btn}>{t("settings.apropos.githubRepoBtn")}</button>
          </div>
        </div>

        {up === "error" && (
          <p className="text-[12.5px] text-white/60">
            {t("settings.apropos.checkError")}
            {upErr && <span className="mt-1 block font-mono text-xs text-white/30">{upErr}</span>}
          </p>
        )}
        {up === "available" && upInfo && (
          <div className="flex flex-col gap-2 border-t border-white/[0.09] pt-3">
            <p className="text-sm text-white">
              {t("settings.apropos.updateAvailablePrefix")} <span className="font-mono text-[var(--accent)]">v{upInfo.version}</span> {t("settings.apropos.updateAvailableSuffix")}
            </p>
            {upInfo.body && (
              <p className="max-h-32 overflow-auto whitespace-pre-line rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/50">{upInfo.body}</p>
            )}
            <button type="button" onClick={() => void downloadInstall()} className={`self-start ${primary}`}>{t("settings.apropos.downloadInstallBtn")}</button>
          </div>
        )}
        {up === "downloading" && (
          <div className="border-t border-white/[0.09] pt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/60">{t("settings.apropos.downloading")}</span>
              <span className="font-mono text-[var(--accent)]">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {up === "ready" && (
          <div className="flex flex-col gap-2 border-t border-white/[0.09] pt-3">
            <p className="text-sm text-emerald-300">{t("settings.apropos.updateReady")}</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void doRelaunch()} className={primary}>{t("settings.apropos.relaunchNowBtn")}</button>
              <button type="button" onClick={() => setUp("idle")} className={btn}>{t("settings.apropos.laterBtn")}</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <section className="glass flex flex-col gap-2 rounded-2xl px-5 py-[18px] text-[12.5px] leading-relaxed text-white/60">
          <h2 className="text-[15px] font-bold text-white">{t("settings.apropos.creditsLabel")}</h2>
          <p>
            <button type="button" onClick={() => open(ONIVOID)} className={link}>Multitool</button> {t("settings.apropos.creditSuffix")}
          </p>
          <p>
            <button type="button" onClick={() => open(DRCHEWBACCA)} className={link}>Dr-Chewbacca</button> {t("settings.apropos.creditChewbacca")}
          </p>
          <p>
            <b className="font-medium text-white/80">{BACKGROUNDS.flatMap((b) => (b.author ? [b.author] : [])).join(", ")}</b> {t("settings.apropos.creditBackgrounds")}
          </p>
        </section>
        <section className="glass flex flex-col gap-2 rounded-2xl px-5 py-[18px] text-[12.5px] leading-relaxed text-white/60">
          <h2 className="text-[15px] font-bold text-white">{t("settings.apropos.licenseLabel")}</h2>
          <p>{t("settings.apropos.licenseCopyright")}</p>
          <p>
            {t("settings.apropos.licenseUnderPrefix")} <button type="button" onClick={() => open(AGPL)} className={link}>GNU AGPL v3</button>
          </p>
          <p>
            {t("settings.apropos.licenseSourcePrefix")} <button type="button" onClick={() => open(REPO)} className={link}>{t("settings.apropos.licenseSourceLink")}</button>
          </p>
        </section>
      </div>
    </>
  );
}
