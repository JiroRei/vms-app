"use client";

import { useState } from "react";

import { QrScanner } from "@/components/qr-scanner";
import { formatFullName } from "@/lib/names";
import type { ValidatedAppointment } from "@/lib/qr";

type Stage = "capture" | "confirm" | "done";

/**
 * Who is standing at the screen. It changes the wording and whether the visit
 * records a guard, and nothing else — both surfaces run the same validation,
 * the same confirmation step and the same check-in call.
 */
export type CheckInMode = "kiosk" | "guard";

const COPY = {
  kiosk: {
    title: "Appointment Check-in",
    subtitle: "Scan the QR code from your invitation",
    manualLabel: "Or enter your reference number",
    confirmTitle: "Is this you?",
    confirmSubtitle: "Please confirm your details to finish checking in",
    confirmAction: "Yes, check me in",
    rejectAction: "That's not me",
    doneTitle: "You're checked in!",
    againAction: "Check in another visitor",
  },
  guard: {
    title: "Scan a visitor in",
    subtitle: "Point the camera at the visitor's QR code",
    manualLabel: "Or type their reference number",
    confirmTitle: "Confirm this check-in",
    confirmSubtitle: "Check the details against the visitor in front of you",
    confirmAction: "Check in visitor",
    rejectAction: "Cancel",
    doneTitle: "Checked in",
    againAction: "Scan the next visitor",
  },
} as const satisfies Record<CheckInMode, Record<string, string>>;

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white";
const errorInputClass = inputClass.replace(
  "border-gray-300",
  "border-red-400",
);
const primaryButtonClass =
  "w-full min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300";
const secondaryButtonClass =
  "w-full min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Scan or type a code, confirm who it belongs to, check them in.
 *
 * One component for the kiosk and the guard's scanner. The two surfaces differ
 * in wording and in whether the resulting visit records who performed it; every
 * decision about whether a code may be used is made server-side by
 * `validateAppointmentToken()`, which both paths reach through the same
 * endpoint. Nothing here re-implements any part of that.
 */
export function AppointmentCheckIn({ mode }: { mode: CheckInMode }) {
  const copy = COPY[mode];

  const [stage, setStage] = useState<Stage>("capture");
  const [reference, setReference] = useState("");
  const [appointment, setAppointment] = useState<ValidatedAppointment | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("capture");
    setReference("");
    setAppointment(null);
    setError(null);
  }

  /**
   * The one path into the confirmation step, whether the code arrived from the
   * camera or the keypad — so a scanned appointment and a typed one are checked
   * identically and shown identically.
   */
  async function validate(token: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/appointments/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "We could not find that appointment.");
        return;
      }

      setAppointment(data.appointment as ValidatedAppointment);
      setStage("confirm");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!reference.trim()) {
      setError("Please enter your reference number.");
      return;
    }

    void validate(reference);
  }

  async function handleConfirm() {
    if (!appointment || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/appointments/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The reference number is re-sent rather than the scanned token: it
          // resolves to the same appointment, and keeps the bearer token out of
          // a second request.
          token: appointment.referenceNumber,
          assisted: mode === "guard",
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // Someone redeemed it between the scan and the confirm — send them back
        // to the start rather than leaving a dead button on screen.
        setError(data?.error ?? "Could not complete check-in.");
        setStage("capture");
        setAppointment(null);
        return;
      }

      setStage("done");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "done" && appointment) {
    return (
      <div className="space-y-6 text-center">
        <div className="space-y-3">
          <span className="text-5xl" role="img" aria-label="Checked in">
            ✅
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {copy.doneTitle}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {mode === "kiosk"
              ? `Welcome, ${formatFullName(appointment.firstName, appointment.lastName)}. Please take a seat — ${appointment.hostName} has been notified.`
              : `${formatFullName(appointment.firstName, appointment.lastName)} is checked in. ${appointment.hostName} has been notified.`}
          </p>
        </div>

        <button type="button" onClick={reset} className={primaryButtonClass}>
          {copy.againAction}
        </button>
      </div>
    );
  }

  if (stage === "confirm" && appointment) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {copy.confirmTitle}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {copy.confirmSubtitle}
          </p>
        </div>

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500 dark:text-gray-400">Name</dt>
            <dd className="text-right text-sm font-semibold text-gray-900 dark:text-white">
              {formatFullName(appointment.firstName, appointment.lastName)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500 dark:text-gray-400">
              Scheduled
            </dt>
            <dd
              className="text-right text-sm text-gray-900 dark:text-white"
              suppressHydrationWarning
            >
              {formatWhen(appointment.scheduledFor)}
            </dd>
          </div>
          {appointment.purposeLabel && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-gray-500 dark:text-gray-400">
                Purpose
              </dt>
              <dd className="text-right text-sm text-gray-900 dark:text-white">
                {appointment.purposeLabel}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500 dark:text-gray-400">Host</dt>
            <dd className="text-right">
              <span className="block text-sm text-gray-900 dark:text-white">
                {appointment.hostName}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {appointment.hostDepartment}
              </span>
            </dd>
          </div>
        </dl>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? "Checking in…" : copy.confirmAction}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className={secondaryButtonClass}
          >
            {copy.rejectAction}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {copy.title}
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {copy.subtitle}
        </p>
      </div>

      {/* Released while the confirmation step is up, and restarted if the
          visitor is sent back here. */}
      <QrScanner active={stage === "capture" && !busy} onScan={validate} />

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/* The fallback is visible rather than hidden behind a link: a kiosk with
          no camera, or a creased printout, is the ordinary case this exists
          for, and hunting for it at a reception desk is the wrong moment. */}
      <form
        onSubmit={handleManualSubmit}
        noValidate
        className="space-y-3 border-t border-gray-200 pt-6 dark:border-gray-700"
      >
        <label
          htmlFor="reference"
          className="block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          {copy.manualLabel}
        </label>
        <input
          id="reference"
          name="reference"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value.toUpperCase());
            if (error) setError(null);
          }}
          placeholder="APT-XXXXXX"
          aria-invalid={Boolean(error)}
          className={`${error ? errorInputClass : inputClass} text-center text-lg font-semibold uppercase tracking-widest`}
        />
        <button type="submit" disabled={busy} className={secondaryButtonClass}>
          {busy ? "Looking up…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
