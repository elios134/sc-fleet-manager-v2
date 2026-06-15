import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

// Système de toast in-app global (Lot 3), calqué sur V1 (components/toast/*).
// Fournisseur réutilisable (toast()/dismiss()) ; ici on ne branche QUE les notifs
// via NotificationToastBridge. Affichage éphémère : ne remplace PAS l'entrée cloche.

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
}

const TOAST_TTL_MS = 5000; // durée d'auto-disparition (cf. V1 ~5 s)

interface ToastContextValue {
  toast: (opts: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0; // id local stable (pas de crypto/Math.random nécessaire)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const h = timers.current[id];
    if (h) {
      clearTimeout(h);
      delete timers.current[id];
    }
  }, []);

  const toast = useCallback(
    (opts: Omit<ToastItem, "id">) => {
      toastSeq += 1;
      const id = `toast-${toastSeq}`;
      setToasts((prev) => [...prev, { ...opts, id }]);
      timers.current[id] = setTimeout(() => dismiss(id), TOAST_TTL_MS);
    },
    [dismiss],
  );

  // Nettoyage des timers au démontage.
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans un ToastProvider");
  return ctx;
}

function accentForType(type: ToastType): string {
  switch (type) {
    case "success":
      return "#22c55e";
    case "error":
      return "#ef4444";
    case "warning":
      return "var(--amber)";
    default:
      return "var(--accent)";
  }
}

// Conteneur des toasts : portail body, en haut à droite, empilés (cf. V1).
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed right-4 top-20 flex w-80 flex-col gap-2"
      style={{ zIndex: 300 }}
      aria-live="polite"
      aria-label={t("toast.notificationsAria")}
    >
      {toasts.map((item) => {
        const color = accentForType(item.type);
        return (
          <div
            key={item.id}
            className="pointer-events-auto overflow-hidden rounded-xl border backdrop-blur-2xl"
            style={{
              background: "rgba(20,20,28,0.97)",
              borderColor: color,
              boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
            }}
          >
            <div className="h-[2px]" style={{ background: color }} aria-hidden />
            <div className="p-3.5">
              <div className="mb-1 flex items-start justify-between gap-2">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider leading-none"
                  style={{ color }}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  aria-label={t("toast.close")}
                  className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs leading-relaxed text-white/80">{item.message}</p>
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export default ToastProvider;
