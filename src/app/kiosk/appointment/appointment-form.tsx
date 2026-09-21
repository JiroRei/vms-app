"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  codeInputClass,
  formErrorClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/app/kiosk/form-styles";
import type { AppointmentDetails } from "@/lib/appointments";

type Stage = "entry" | "confirm" | "done";

/**
 * `offerWalkIn` separates "this reference will never work" from "the request
 * didn't get through". Only the first is a reason to send the visitor to the
 * walk-in form — offering it after a network blip would throw away a perfectly
 * good appointment.
 */
type LookupError = { message: string; offerWalkIn: boolean };

/** Long enough for any seeded reference, short enough to stop pasted junk. */
const MAX_REFERENCE_LENGTH = 32;

const NETWORK_ERROR: LookupError = {
  message:
    "Could not reach the check-in system. Please try again, or ask reception for help.",
  offerWalkIn: false,
};

/** A 404/409 means the reference is unusable, not that the request failed. */
function isUnusableReference(status: number): boolean {
  return status === 404 || status === 409;
}

export function AppointmentForm() {
  const referenceInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("entry");
  const [reference, setReference] = useState("");
  const [appointment, setAppointment] = useState<AppointmentDetails | null>(
    null,
  );
  const [error, setError] = useState<LookupError | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("entry");
    setReference("");
    setAppointment(null);
    setError(null);
  }

  /** Sends them back to the start with the reason still on screen. */
  function failBackToEntry(failure: LookupError) {
    setError(failure);
    setStage("entry");
    setAppointment(null);
  }

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Disabled while busy, but a double-tap can land both presses before React
    // has re-rendered the button.
    if (busy) return;

    const trimmed = reference.trim();

    if (!trimmed) {
      setError({
        message: "Please enter your reference number.",
        offerWalkIn: false,
      });
      referenceInput.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(trimmed)}`,
        { cache: "no-store" },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError({
          message:
            data?.error ?? "Reference number not found or already used.",
          offerWalkIn: isUnusableReference(response.status),
        });
        referenceInput.current?.focus();
        return;
      }

      setAppointment(data.appointment as AppointmentDetails);
      setStage("confirm");
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (busy || !appointment) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(appointment.referenceNumber)}/check-in`,
        { method: "POST" },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // Someone redeemed it between lookup and confirm — send them back to
        // the start rather than leaving a dead confirm button on screen.
        failBackToEntry({
          message: data?.error ?? "Could not complete check-in.",
          offerWalkIn: isUnusableReference(response.status),
        });
        return;
      }

      setStage("done");
    } catch {
      // The appointment may well still be valid, so keep them on the confirm
      // screen where one more tap retries it.
      setError(NETWORK_ERROR);
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            You&apos;re checked in!
          </h1>
          <p className="text-base text-gray-500">
            Welcome, {appointment.visitorName}. Please take a seat —{" "}
            {appointment.hostName} has been notified.
          </p>
        </div>

        <button type="button" onClick={reset} className={primaryButtonClass}>
          Check in another visitor
        </button>
      </div>
    );
  }

  if (stage === "confirm" && appointment) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Is this you?
          </h1>
          <p className="mt-2 text-base text-gray-500">
            Please confirm your details to finish checking in
          </p>
        </div>

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Name</dt>
            <dd className="text-right text-sm font-semibold text-gray-900">
              {appointment.visitorName}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Purpose</dt>
            <dd className="text-right text-sm text-gray-900">
              {appointment.purpose}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Host</dt>
            <dd className="text-right">
              <span className="block text-sm text-gray-900">
                {appointment.hostName}
              </span>
              <span className="block text-xs text-gray-500">
                {appointment.hostDepartment}
              </span>
            </dd>
          </div>
        </dl>

        {error && <ErrorNotice error={error} />}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? "Checking in…" : "Yes, check me in"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className={secondaryButtonClass}
          >
            That&apos;s not me
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Appointment Check-in
        </h1>
        <p className="mt-2 text-base text-gray-500">
          Enter the reference number from your invitation
        </p>
      </div>

      <form onSubmit={handleLookup} noValidate className="space-y-4">
        <div>
          <label htmlFor="reference" className={labelClass}>
            Reference Number
          </label>
          <input
            ref={referenceInput}
            id="reference"
            name="reference"
            type="text"
            // Unattended kiosk: the visitor should be able to type straight away.
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={MAX_REFERENCE_LENGTH}
            value={reference}
            onChange={(event) => {
              setReference(event.target.value.toUpperCase());
              // Drop the previous attempt's complaint as soon as they retype.
              if (error) setError(null);
            }}
            placeholder="APT-1001"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "reference-error" : undefined}
            className={codeInputClass(Boolean(error))}
          />
        </div>

        {error && <ErrorNotice error={error} id="reference-error" />}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Looking up…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

/**
 * One rendering for both stages. The walk-in escape hatch appears only when the
 * reference itself is the problem.
 */
function ErrorNotice({ error, id }: { error: LookupError; id?: string }) {
  if (!error.offerWalkIn) {
    return (
      <p id={id} role="alert" className={formErrorClass}>
        {error.message}
      </p>
    );
  }

  return (
    <div
      id={id}
      role="alert"
      className={`${formErrorClass} space-y-2`}
    >
      <p>{error.message}</p>
      <Link
        href="/kiosk/walkin"
        className="inline-block font-semibold underline underline-offset-2 hover:text-red-900"
      >
        Register as a walk-in instead
      </Link>
    </div>
  );
}
