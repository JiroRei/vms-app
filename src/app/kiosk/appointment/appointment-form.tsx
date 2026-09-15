"use client";

import Link from "next/link";
import { useState } from "react";

import type { AppointmentDetails } from "@/lib/appointments";

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const errorInputClass =
  "block w-full rounded-lg border border-red-400 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";
const primaryButtonClass =
  "w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:bg-blue-300";
const secondaryButtonClass =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50";

type Stage = "entry" | "confirm" | "done";

export function AppointmentForm() {
  const [stage, setStage] = useState<Stage>("entry");
  const [reference, setReference] = useState("");
  const [appointment, setAppointment] = useState<AppointmentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("entry");
    setReference("");
    setAppointment(null);
    setError(null);
  }

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = reference.trim();

    if (!trimmed) {
      setError("Please enter your reference number.");
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
        setError(data?.error ?? "Reference number not found or already used.");
        return;
      }

      setAppointment(data.appointment as AppointmentDetails);
      setStage("confirm");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!appointment) return;

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
        setError(data?.error ?? "Could not complete check-in.");
        setStage("entry");
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            You&apos;re checked in!
          </h1>
          <p className="text-sm text-gray-500">
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Is this you?
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Please confirm your details to finish checking in
          </p>
        </div>

        <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Name</dt>
            <dd className="text-sm font-semibold text-gray-900 text-right">
              {appointment.visitorName}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Purpose</dt>
            <dd className="text-sm text-gray-900 text-right">
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

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Appointment Check-in
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Enter the reference number from your invitation
        </p>
      </div>

      <form onSubmit={handleLookup} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="reference"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Reference Number
          </label>
          <input
            id="reference"
            name="reference"
            type="text"
            // Unattended kiosk: the visitor should be able to type straight away.
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value.toUpperCase());
              if (error) setError(null);
            }}
            placeholder="APT-1001"
            aria-invalid={Boolean(error)}
            className={`${error ? errorInputClass : inputClass} text-center text-lg font-semibold tracking-widest uppercase`}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700"
          >
            <p>{error}</p>
            <Link
              href="/kiosk/walkin"
              className="inline-block font-semibold underline underline-offset-2 hover:text-red-900"
            >
              Register as a walk-in instead
            </Link>
          </div>
        )}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Looking up…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
