// Avis de mise à jour au lancement : (1) toast « vX disponible » avec un aperçu des nouveautés,
// (2) fenêtre « Quoi de neuf » une seule fois au premier lancement après une montée de version.
// Silencieux hors-ligne / sans release (404 attendu, rien ne bloque).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { useToast } from "./Toast";
import { WhatsNewModal } from "./WhatsNewModal";
import { noteHeadlines, parseReleaseNotes, whatsNewFrom } from "../lib/releaseNotes";

const LAST_SEEN_KEY = "ui.lastSeenVersion";
export type ReleaseInfo = { version: string; date: string | null; body: string };
type Shown = { version: string; from: string | null; date: string | null; body: string; kind: "installed" | "available" };

export function UpdateNotices() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shown, setShown] = useState<Shown | null>(null);

  // Fenêtre « Quoi de neuf » après une montée de version (la version vue est mémorisée tout de suite).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await getVersion();
        const last = await invoke<string | null>("get_app_meta", { key: LAST_SEEN_KEY }).catch(() => null);
        if (last !== current) await invoke("set_app_meta", { key: LAST_SEEN_KEY, value: current }).catch(() => {});
        const from = whatsNewFrom(last, current);
        if (!from) return;
        const releases = await invoke<ReleaseInfo[]>("get_releases");
        const r = releases.find((x) => x.version === current);
        if (!cancelled && r && parseReleaseNotes(r.body).length > 0) {
          setShown({ version: current, from, date: r.date, body: r.body, kind: "installed" });
        }
      } catch {
        /* hors-ligne ou sans release : pas de fenêtre */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mise à jour disponible : toast avec les premières nouveautés.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const u = await check();
        if (cancelled || !u) return;
        const heads = noteHeadlines(parseReleaseNotes(u.body), 3);
        const body = u.body ?? "";
        toast({
          type: "info",
          title: t("layout.updateAvailableTitle"),
          message: heads.length ? `v${u.version} · ${heads.join(" · ")}` : t("layout.updateAvailableBody", { version: u.version }),
          actions: [
            { label: t("whatsNew.update"), onClick: () => navigate("/settings#apropos", { state: { checkUpdate: true } }) },
            ...(heads.length
              ? [{ label: t("whatsNew.see"), onClick: () => setShown({ version: u.version, from: null, date: u.date ?? null, body, kind: "available" }) }]
              : []),
          ],
        });
      } catch {
        /* silencieux : 404/réseau attendu tant qu'aucune release n'est publiée */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, t, navigate]);

  if (!shown) return null;
  const close = () => setShown(null);
  return (
    <WhatsNewModal
      version={shown.version}
      from={shown.from}
      date={shown.date}
      body={shown.body}
      eyebrow={shown.kind === "installed" ? t("whatsNew.installed") : t("whatsNew.available")}
      primaryLabel={shown.kind === "installed" ? t("whatsNew.letsGo") : t("whatsNew.update")}
      onPrimary={() => {
        close();
        if (shown.kind === "available") navigate("/settings#apropos", { state: { checkUpdate: true } });
      }}
      onClose={close}
    />
  );
}
