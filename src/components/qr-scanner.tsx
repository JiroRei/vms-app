"use client";

import { useEffect, useRef, useState } from "react";

type Status = "starting" | "scanning" | "unavailable";

/**
 * html5-qrcode mounts into an element it finds by id, so the id has to be
 * stable and unique. Only one scanner is ever on screen at a time.
 */
const REGION_ID = "qr-scanner-region";

/**
 * Camera-based QR scanning.
 *
 * html5-qrcode is loaded with a dynamic `import()` inside the effect rather than
 * at module scope: it reaches for `document` as it initialises, which would
 * break the server render of the page that holds it, and this way it is not in
 * the initial bundle for visitors who never open a scanner.
 *
 * Failing to start is an ordinary outcome, not an error — a kiosk may have no
 * camera and a visitor may decline the permission prompt. It says so plainly and
 * leaves the caller's manual fallback to carry the check-in.
 */
export function QrScanner({
  onScan,
  active = true,
}: {
  onScan: (value: string) => void;
  /** Set false to release the camera — e.g. while a confirmation step is up. */
  active?: boolean;
}) {
  const [status, setStatus] = useState<Status>("starting");

  // Held in a ref so a new callback identity on every parent render does not
  // tear the camera down and start it again. Written in an effect rather than
  // during render, which would be a side effect in the render pass.
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let cancelled = false;
    // The camera decodes continuously; the parent only wants the first read.
    let handled = false;

    async function start() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");

        if (cancelled) return;

        scanner = new Html5Qrcode(REGION_ID, false);

        await scanner.start(
          // The back camera on a phone, the only camera on a kiosk.
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (handled) return;
            handled = true;
            onScanRef.current(decoded);
          },
          // Fires for every frame without a readable code, which is most of
          // them. Nothing to report.
          () => {},
        );

        if (cancelled) return;
        setStatus("scanning");
      } catch {
        if (cancelled) return;
        setStatus("unavailable");
      }
    }

    void start();

    return () => {
      cancelled = true;

      // `stop()` rejects when the camera never started, which is exactly the
      // case this cleanup also has to handle.
      scanner
        ?.stop()
        .catch(() => {})
        .finally(() => scanner?.clear());
    };
  }, [active]);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-900 dark:border-gray-700">
        {/* Always rendered: html5-qrcode looks this element up by id, so it
            must exist before the effect runs and must not vanish underneath a
            running camera. */}
        <div id={REGION_ID} className="mx-auto w-full" />

        {status !== "scanning" && (
          <p className="px-4 py-8 text-center text-sm text-gray-300">
            {status === "starting"
              ? "Starting the camera…"
              : "No camera available. Use the reference number below instead."}
          </p>
        )}
      </div>

      {status === "scanning" && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          Hold the QR code from your invitation up to the camera.
        </p>
      )}
    </div>
  );
}
