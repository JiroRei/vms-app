"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

import { useIdleTimeout } from "./use-idle-timeout";

/** The screen an abandoned kiosk returns to. */
const KIOSK_HOME = "/kiosk";

/** Total idle time before the kiosk resets itself. */
const IDLE_MS = 60_000;
/** The tail of that minute, spent asking whether anyone is still there. */
const WARNING_MS = 15_000;

/**
 * Returns an abandoned kiosk to the chooser screen.
 *
 * Mounted once in the kiosk layout rather than inside each form, so it covers
 * every flow — including the "You're checked in!" confirmations, which would
 * otherwise sit on screen with the last visitor's name until someone touched
 * them.
 *
 * `replace` rather than `push`: an unattended terminal should not accumulate
 * history, and the back button must not walk the next visitor into the previous
 * one's half-filled form.
 */
export function KioskIdleReset() {
  const router = useRouter();
  const pathname = usePathname();

  // The chooser is already the screen a reset lands on — nothing to reset from,
  // and no half-entered details to clear.
  const enabled = pathname !== KIOSK_HOME;

  const onIdle = useCallback(() => {
    router.replace(KIOSK_HOME);
  }, [router]);

  const { warning, secondsLeft, stayActive } = useIdleTimeout({
    idleMs: IDLE_MS,
    warningMs: WARNING_MS,
    onIdle,
    enabled,
  });

  if (!warning) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="kiosk-idle-title"
      aria-describedby="kiosk-idle-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-xl">
        <div className="space-y-2">
          <h2
            id="kiosk-idle-title"
            className="text-xl font-bold tracking-tight text-gray-900"
          >
            Are you still there?
          </h2>
          <p id="kiosk-idle-description" className="text-sm text-gray-500">
            This screen will start over in{" "}
            <span className="font-semibold tabular-nums text-gray-900">
              {secondsLeft}
            </span>{" "}
            {secondsLeft === 1 ? "second" : "seconds"} so it&apos;s ready for the
            next visitor.
          </p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            autoFocus
            onClick={stayActive}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
          >
            I&apos;m still here
          </button>
          <button
            type="button"
            onClick={onIdle}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}
