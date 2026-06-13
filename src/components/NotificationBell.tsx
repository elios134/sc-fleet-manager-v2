import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bell, Check, Trash2, X } from "lucide-react";

// Cloche + centre de notifications (Lot 2). S'appuie sur le socle Lot 1 :
//   list_notifications / unread_count / mark_notification_read / mark_all_read /
//   delete_notification / delete_all_notifications + l'event "notification:new".
// Règle clé (specs André) : s'il n'y a AUCUNE notif, la cloche disparaît du header.
// Comportement « lu » calqué sur V1 : l'ouverture NE marque PAS lu — seul le bouton
// « Tout marquer lu » le fait (ou la croix supprime une ligne).

type Notification = {
  id: number;
  type: string;
  title: string;
  body: string;
  relatedShipId: number | null;
  firedAt: string;
  readAt: string | null;
};

// "2026-06-13 08:12:00" (UTC, datetime('now')) → Date locale. Cf. convention V2.
function parseUtc(s: string): number {
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

// Âge relatif en français : « à l'instant / il y a 5 min / il y a 2 h / il y a 3 j ».
function relativeAge(iso: string): string {
  const diff = Date.now() - parseUtc(iso);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

export function NotificationBell() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // Position fixe du panneau (portail), calée sous la cloche.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Recale le panneau sous la cloche (coin haut-droit aligné sur la cloche).
  const placePanel = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        invoke<Notification[]>("list_notifications", { limit: 50 }),
        invoke<number>("unread_count"),
      ]);
      setNotifs(list);
      setUnread(count);
    } catch {
      /* silencieux : la cloche reste cohérente avec son dernier état connu */
    }
  }, []);

  // Chargement initial + écoute temps réel (nouvelle notif, changement de compte).
  useEffect(() => {
    void refresh();
    const pending = [
      listen("notification:new", () => void refresh()),
      listen("account:switched", () => {
        setOpen(false);
        void refresh();
      }),
    ];
    return () => {
      pending.forEach((p) => void p.then((un) => un()));
    };
  }, [refresh]);

  // Si plus aucune notif, le panneau se referme.
  useEffect(() => {
    if (notifs.length === 0) setOpen(false);
  }, [notifs.length]);

  // Fermeture au clic extérieur (le panneau étant dans un portail, on exclut aussi
  // panelRef en plus de wrapRef) + recalage sur resize/scroll tant qu'ouvert.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [open, placePanel]);

  async function markAllRead() {
    try {
      await invoke("mark_all_read");
    } finally {
      void refresh();
    }
  }

  async function deleteOne(id: number) {
    try {
      await invoke("delete_notification", { id });
    } finally {
      void refresh();
    }
  }

  async function deleteAll() {
    try {
      await invoke("delete_all_notifications");
    } finally {
      void refresh();
    }
  }

  // SPEC ANDRÉ : aucune notif → pas d'icône du tout.
  if (notifs.length === 0) return null;

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => {
          if (!open) placePanel();
          setOpen((v) => !v);
        }}
        title="Notifications"
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ background: "var(--accent)", border: "2px solid #0a0a0f" }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && anchor &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed w-80 overflow-hidden rounded-2xl border border-white/10 backdrop-blur-2xl"
            style={{
              top: anchor.top,
              right: anchor.right,
              // Au-dessus du contenu des pages (contexte z-10) et de la nav (z-30),
              // mais sous les modales plein écran (z-50) — qui restent prioritaires.
              zIndex: 40,
              background: "rgba(20,20,28,0.95)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
            }}
          >
          {/* En-tête : titre + actions */}
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/70">
              Notifications{unread > 0 ? ` (${unread})` : ""}
            </span>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => void markAllRead()}
                  title="Tout marquer lu"
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  Tout lu
                </button>
              )}
              <button
                onClick={() => void deleteAll()}
                title="Tout supprimer"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/60 transition-colors hover:bg-red-500/20 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vider
              </button>
            </div>
          </div>

          {/* Liste */}
          <div className="max-h-[60vh] overflow-y-auto">
            {notifs.map((n) => (
              <div
                key={n.id}
                className="group flex items-start gap-2 border-b border-white/5 px-3 py-2.5 last:border-b-0"
                style={{ opacity: n.readAt ? 0.55 : 1 }}
              >
                {/* Point de non-lue (sinon espace réservé pour aligner) */}
                {n.readAt ? (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0" aria-hidden />
                ) : (
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--accent)" }}
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white/90">{n.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/60">{n.body}</p>
                  <p className="mt-1 text-[10px] text-white/40">{relativeAge(n.firedAt)}</p>
                </div>
                {/* Croix par ligne (bonus) */}
                <button
                  onClick={() => void deleteOne(n.id)}
                  title="Supprimer"
                  aria-label="Supprimer cette notification"
                  className="shrink-0 rounded-md p-1 text-white/30 opacity-0 transition-all hover:bg-white/10 hover:text-white/80 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

export default NotificationBell;
