import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";

type FrNamesBackfillResult = {
  blueprintsScanned: number;
  frWritten: number;
  frMissingTranslation: number;
  scitemMissing: number;
  locKeyMissing: number;
  entityClassMissing: number;
  dbRowMissing: number;
  errors: number;
  frDir: string;
};

// Bloc 4 — Phase C' : moteur de routes profit/temps.
type CargoRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  buyPrice: number;
  sellPrice: number;
  marginUnit: number;
  quantityScu: number;
  profit: number;
  fromSystem: string | null;
  toSystem: string | null;
  jumps: number | null;
  distanceGm: number | null;
  timeMinutes: number | null;
  profitPerMinute: number | null;
  fuel: number | null;
};
type FindRoutesResult = {
  shipName: string;
  cargoScu: number | null;
  qtDriveSpeed: number | null;
  qtSpoolTime: number | null;
  qtResolved: boolean;
  investment: number;
  routesConsidered: number;
  routesWithTime: number;
  routes: CargoRoute[];
  note: string;
};

function DiagnosticTab() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<
    "seed" | "remove" | "frNames" | "cargoRef" | "cargoRoutes" | "uex" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "seed" | "remove") {
    setError(null);
    setNotice(null);
    setLoading(action);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setError(t("settings.diagnostic.noActiveAccount"));
        return;
      }
      if (action === "seed") {
        await invoke("seed_sample_pack", { accountId });
        setNotice(t("settings.diagnostic.seedNotice"));
      } else {
        await invoke("remove_sample_pack", { accountId });
        setNotice(t("settings.diagnostic.removeNotice"));
      }
      await emit("fleet:synced"); // rafraîchit My Fleet / Dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  // Backfill des noms FR de blueprint (producedItemNameFr) depuis les dumps.
  async function runFrNames() {
    setError(null);
    setNotice(null);
    setLoading("frNames");
    try {
      const r = await invoke<FrNamesBackfillResult>("backfill_blueprint_names_fr");
      setNotice(
        t("settings.diagnostic.frNamesNotice", {
          written: r.frWritten,
          scanned: r.blueprintsScanned,
          missing: r.frMissingTranslation,
          dir: r.frDir,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  // Bloc 4 — Phase A : sync du cache de référence (commodities, shops, ships,
  // lieux SC Wiki, positions x/y/z, mapping). DEV uniquement (pas d'i18n).
  async function runCargoRef() {
    setError(null);
    setNotice(null);
    setLoading("cargoRef");
    try {
      const r = await invoke<CargoReferenceSyncReport>("sync_cargo_reference");
      const pos = r.positionsOk
        ? `positions ${r.positions} (+${r.jumpConnections} sauts)`
        : `positions ÉCHEC → fallback marge brute (${r.positionsError ?? "?"})`;
      setNotice(
        `Cache Cargo synchronisé — commodities ${r.commodities}, shops ${r.shops}, ` +
          `ships(API) ${r.shipsApi}, lieux Wiki ${r.wikiLocations}, ${pos}. ` +
          `Mapping ${r.mappingMatched}/${r.mappingTotal} (alias ${r.mappingViaAlias}, non résolus ${r.mappingUnmatched}). ` +
          `Hubs d'audit ${r.auditHubsMatched}/${r.auditHubsTotal}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  // Bloc 4 — Bascule UEX : sync du cache prix + stock UEX. DEV uniquement.
  async function runUexSync() {
    setError(null);
    setNotice(null);
    setLoading("uex");
    try {
      const r = await invoke<UexSyncReport>("sync_uex_prices");
      setNotice(
        `UEX synchronisé — ${r.prices} prix · ${r.terminals} terminaux ` +
          `(commerce ${r.commodityTerminals}, mappés ${r.terminalsMapped}, non rattachés ${r.terminalsUnmapped}). ` +
          `Hubs ${r.hubsMatched}/${r.hubsTotal}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  // Bloc 4 — Phase C' : test du moteur de routes (vaisseau auto + budget). DEV uniquement.
  async function runCargoRoutes() {
    setError(null);
    setNotice(null);
    setLoading("cargoRoutes");
    try {
      const r = await invoke<FindRoutesResult>("find_cargo_routes_demo", {
        investment: 1_000_000,
        limit: 10,
      });
      // Détail complet dans la console (terminal devtools).
      console.log("[find_cargo_routes_demo]", r);
      const top = r.routes
        .slice(0, 5)
        .map((x, i) => {
          const t = x.profitPerMinute != null ? `${Math.round(x.profitPerMinute)} aUEC/min` : "marge brute";
          const d = x.distanceGm != null ? `${x.distanceGm.toFixed(2)} Gm` : "dist?";
          const tm = x.timeMinutes != null ? `${x.timeMinutes.toFixed(1)} min` : "temps?";
          return `${i + 1}. ${x.commodity}: ${x.fromLocation} → ${x.toLocation} | ${Math.round(
            x.profit,
          )} aUEC (${x.quantityScu} SCU) | ${d} / ${tm} | ${t}`;
        })
        .join("\n");
      setNotice(
        `Vaisseau ${r.shipName} (cargo ${r.cargoScu ?? "?"} SCU, QT ${
          r.qtResolved ? `${Math.round((r.qtDriveSpeed ?? 0) / 1000)} km/s` : "non résolu"
        }) — ${r.routesConsidered} routes, ${r.routesWithTime} avec temps.\n${top}\n(${r.note})`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 whitespace-pre-line rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          {notice}
        </p>
      )}

      <p className="mb-4 text-sm text-white/40">{t("settings.diagnostic.intro")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => run("seed")}
          disabled={loading !== null}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <p className="text-sm font-semibold text-emerald-300">
            {loading === "seed"
              ? t("settings.diagnostic.creating")
              : t("settings.diagnostic.createPackBtn")}
          </p>
          <p className="mt-1 text-xs text-white/40">{t("settings.diagnostic.createPackDesc")}</p>
        </button>

        <button
          onClick={() => run("remove")}
          disabled={loading !== null}
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <p className="text-sm font-semibold text-red-300">
            {loading === "remove"
              ? t("settings.diagnostic.removing")
              : t("settings.diagnostic.removePackBtn")}
          </p>
          <p className="mt-1 text-xs text-white/40">{t("settings.diagnostic.removePackDesc")}</p>
        </button>

        <button
          onClick={() => void runFrNames()}
          disabled={loading !== null}
          className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-left transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
        >
          <p className="text-sm font-semibold text-accent">
            {loading === "frNames"
              ? t("settings.diagnostic.frNamesRunning")
              : t("settings.diagnostic.frNamesBtn")}
          </p>
          <p className="mt-1 text-xs text-white/40">{t("settings.diagnostic.frNamesDesc")}</p>
        </button>

        <button
          onClick={() => void runCargoRef()}
          disabled={loading !== null}
          className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-left transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
        >
          <p className="text-sm font-semibold text-sky-300">
            {loading === "cargoRef"
              ? "Sync Cargo & Routes (Phase A) en cours…"
              : "Sync Cargo & Routes — cache de référence (Phase A)"}
          </p>
          <p className="mt-1 text-xs text-white/40">
            Télécharge commodities/shops/ships (SC Trade Tools) + lieux & positions x/y/z (SC Wiki) et
            construit le mapping lieux. Idempotent. Les positions sont isolées (un échec n'interrompt pas le reste).
          </p>
        </button>

        <button
          onClick={() => void runUexSync()}
          disabled={loading !== null}
          className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-left transition-colors hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
        >
          <p className="text-sm font-semibold text-teal-300">
            {loading === "uex" ? "Sync UEX (prix + stock) en cours…" : "Sync UEX (prix + stock) — source primaire"}
          </p>
          <p className="mt-1 text-xs text-white/40">
            Aspire UEX commodities_prices_all (prix d'achat/vente + stock + demande réels) + terminaux, mappés à SC Wiki
            pour les distances. 1 appel, lecture publique. Nécessite la Phase A (positions SC Wiki) pour les distances.
          </p>
        </button>


        <button
          onClick={() => void runCargoRoutes()}
          disabled={loading !== null}
          className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-left transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
        >
          <p className="text-sm font-semibold text-cyan-300">
            {loading === "cargoRoutes"
              ? "Calcul des routes (Phase C') en cours…"
              : "Test moteur de routes profit/temps (Phase C')"}
          </p>
          <p className="mt-1 text-xs text-white/40">
            Lance find_cargo_routes sur le vaisseau de la flotte au plus gros cargo + budget 1 000 000 aUEC.
            Affiche le top 5 (détail complet en console). Nécessite les Phases A + B'.
          </p>
        </button>
      </div>
    </div>
  );
}

export { DiagnosticTab };
