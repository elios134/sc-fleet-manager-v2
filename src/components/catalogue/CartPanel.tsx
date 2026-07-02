import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, MapPin, Navigation, Route, ShoppingCart, Trash2, X } from "lucide-react";
import Dropdown from "../ui/Dropdown";
import type { CartItem } from "../../lib/useCart";

/* Panneau panier (drawer) : lignes du panier + total « à partir de » + choix du départ
   (pré-rempli avec le lieu détecté en jeu) + bouton « Calculer la route » → itinéraire
   optimisé par temps de trajet (backend plan_shopping_route). */

type StartLocation = { uuid: string; name: string; system: string | null };
type StopItem = { name: string; price: number };
type RouteStop = {
  terminalName: string;
  location: string;
  system: string | null;
  items: StopItem[];
  subtotalAuec: number;
  legMinutes: number | null;
  legJumps: number;
  positioned: boolean;
};
type ShoppingRouteResult = {
  found: boolean;
  stops: RouteStop[];
  totalAuec: number;
  totalMinutes: number | null;
  totalJumps: number;
  unresolvedItems: string[];
  timed: boolean;
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function CartPanel({
  items,
  onRemove,
  onClear,
  onClose,
}: {
  items: CartItem[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [starts, setStarts] = useState<StartLocation[]>([]);
  const [startUuid, setStartUuid] = useState("");
  const [detected, setDetected] = useState<string | null>(null);
  const [result, setResult] = useState<ShoppingRouteResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lieux de départ + position détectée (défaut = meilleur match du lieu en jeu).
  useEffect(() => {
    let alive = true;
    Promise.all([
      invoke<StartLocation[]>("get_start_locations").catch(() => []),
      invoke<string | null>("get_current_location").catch(() => null),
    ]).then(([locs, cur]) => {
      if (!alive) return;
      setStarts(locs);
      setDetected(cur);
      if (cur) {
        const nc = norm(cur);
        const match = locs.find((l) => norm(l.name) === nc) ?? locs.find((l) => norm(l.name).includes(nc) || nc.includes(norm(l.name)));
        if (match) setStartUuid(match.uuid);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const total = useMemo(() => items.reduce((a, it) => a + (it.price ?? 0), 0), [items]);
  const someMissingPrice = items.some((it) => it.price == null);
  const startName = starts.find((s) => s.uuid === startUuid)?.name ?? null;
  const detectedMatches = detected != null && startName != null && norm(detected) === norm(startName);

  async function computeRoute() {
    if (items.length === 0) return;
    setComputing(true);
    setError(null);
    try {
      const res = await invoke<ShoppingRouteResult>("plan_shopping_route", {
        items: items.map((it) => ({ idItem: it.idItem ?? null, uuid: it.uuid ?? null, name: it.name })),
        startUuid: startUuid || null,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComputing(false);
    }
  }

  function sendToOverlay() {
    if (!result?.found) return;
    const steps = result.stops.map((s, i) => ({
      from: i === 0 ? startName ?? t("cart.startAny") : result.stops[i - 1].terminalName,
      to: s.terminalName,
      commodity: s.items.map((it) => it.name).join(", "),
      minutes: s.legMinutes ?? undefined,
      jumps: s.legJumps || undefined,
    }));
    const payload = { source: "cart", steps };
    void invoke("set_app_meta", { key: "overlay.nav", value: JSON.stringify(payload) }).catch(() => {});
    void emit("overlay:nav", payload).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0f0f16]">
        <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-5 py-4">
          <ShoppingCart className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-base font-semibold text-white">{t("cart.title")}</span>
          <span className="text-xs text-white/40">{t("cart.count", { n: items.length })}</span>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/50 hover:bg-white/10" aria-label={t("cart.close")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/40">
              {t("cart.empty")}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {items.map((it) => (
                  <div key={it.key} className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-white/85">{it.name}</span>
                    <span className="shrink-0 text-white/60">{it.price != null ? `${fmt(it.price)}` : "—"}</span>
                    <button onClick={() => onRemove(it.key)} className="shrink-0 text-white/30 hover:text-white/70" aria-label={t("cart.remove")}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
                <span className="text-xs text-white/50">{t("cart.totalFrom")}</span>
                <span className="text-lg font-semibold text-white">
                  {fmt(total)} <span className="text-xs text-white/50">aUEC</span>
                  {someMissingPrice && <span className="ml-1 text-[10px] text-white/30">*</span>}
                </span>
              </div>

              {/* Point de départ */}
              <div className="mt-4">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-white/40">
                  <MapPin className="h-3 w-3 text-[var(--accent)]" /> {t("cart.startPoint")}
                  {detectedMatches && (
                    <span className="rounded-full border border-white/15 px-1.5 py-px text-[9px] uppercase text-white/40">
                      {t("cart.detected")}
                    </span>
                  )}
                </div>
                <Dropdown
                  value={startUuid}
                  onChange={setStartUuid}
                  ariaLabel={t("cart.startPoint")}
                  searchable
                  options={[
                    { value: "", label: t("cart.startAny") },
                    ...starts.map((s) => ({ value: s.uuid, label: s.system ? `${s.name} · ${s.system}` : s.name })),
                  ]}
                />
              </div>

              <button
                onClick={() => void computeRoute()}
                disabled={computing || items.length === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                {t("cart.computeRoute")}
              </button>

              {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

              {/* Résultat itinéraire */}
              {result && (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">
                      <Route className="h-3.5 w-3.5" /> {t("cart.itinerary")}
                    </p>
                    {result.found && (
                      <button
                        onClick={sendToOverlay}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10"
                      >
                        <Navigation className="h-3 w-3" /> {t("cart.sendOverlay")}
                      </button>
                    )}
                  </div>

                  {!result.found ? (
                    <p className="text-sm text-white/40">{t("cart.noRoute")}</p>
                  ) : (
                    <>
                      <div className="mb-4 grid grid-cols-3 gap-2">
                        <Stat label={t("cart.time")} value={result.totalMinutes != null ? `${result.totalMinutes.toFixed(1)} ${t("cargo.unit.min")}` : "—"} />
                        <Stat label={t("cart.jumps")} value={`${result.totalJumps}`} />
                        <Stat label={t("cart.total")} value={fmt(result.totalAuec)} />
                      </div>

                      <ol className="flex flex-col gap-0">
                        {result.stops.map((s, i) => (
                          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                            {i < result.stops.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-white/10" />}
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-xs font-semibold text-[var(--accent)]">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-medium text-white">{s.terminalName}</span>
                                <span className="shrink-0 text-[12px] text-white/70">{fmt(s.subtotalAuec)}</span>
                              </div>
                              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-white/50">
                                <span className="truncate">{s.location}</span>
                                {s.legMinutes != null && (
                                  <span className="ml-auto flex shrink-0 items-center gap-1 text-white/40">
                                    <ArrowRight className="h-3 w-3" />
                                    {s.legMinutes.toFixed(1)} {t("cargo.unit.min")}
                                    {s.legJumps > 0 && ` · ${t("cart.jumpsShort", { n: s.legJumps })}`}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {s.items.map((it, j) => (
                                  <span key={j} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                                    {it.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>

                      {!result.timed && <p className="mt-3 text-[11px] text-white/40">{t("cart.noTimeModel")}</p>}
                      {result.unresolvedItems.length > 0 && (
                        <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                          {t("cart.unresolved", { items: result.unresolvedItems.join(", ") })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {items.length > 0 && (
          <footer className="shrink-0 border-t border-white/10 px-5 py-3">
            <button onClick={onClear} className="flex items-center gap-2 text-xs text-white/50 hover:text-white/80">
              <Trash2 className="h-3.5 w-3.5" /> {t("cart.clear")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
