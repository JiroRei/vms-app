"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastTone = "success" | "error";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

/** Long enough to read a short sentence, short enough not to stack up. */
const TOAST_DURATION_MS = 4000;

type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast | null>(null);

/**
 * Confirmation for a guard who should not have to re-read the table to know
 * their tap registered.
 *
 * A context rather than per-component state because the dashboard fires actions
 * from three places at once — the live table's rows, the delivery modal and the
 * stale-visit cleanup — and they should all land in the same corner of the
 * screen instead of each inventing a spot for their own message.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Ids only have to be unique within a session, and a counter cannot collide
  // the way `Date.now()` can when two actions resolve in the same millisecond.
  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const show = useCallback<ShowToast>((message, tone = "success") => {
    const id = nextId.current++;

    setToasts((current) => [...current, { id, message, tone }]);

    timers.current.push(
      setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_DURATION_MS),
    );
  }, []);

  // Navigating away mid-toast would otherwise leave a timer holding a setState
  // for an unmounted provider.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}

      <div
        // `polite` rather than `assertive`: these confirm what the guard just
        // did, so they should not cut across whatever is being read out.
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.tone === "error"
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-950 dark:text-red-200"
                : "border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-950 dark:text-green-200"
            }`}
          >
            <span aria-hidden className="text-base">
              {toast.tone === "error" ? "⚠️" : "✓"}
            </span>
            <span className="flex-1">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws outside the provider — a silent no-op would hide missing feedback. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);

  if (!show) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }

  return show;
}
