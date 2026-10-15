"use client";
import { apiErrorMessage } from "@/lib/api-error-message";


import { useState } from "react";

import { QrScanner } from "@/components/qr-scanner";
import { formatFullName } from "@/lib/names";
import type { ValidatedAppointment } from "@/lib/qr";
import { SITE_TIMEZONE } from "@/lib/site-config";

type Stage = "capture" | "confirm" | "pick" | "walk-in" | "done";

/**
 * Who is standing at the screen. It changes the wording and whether the visit
 * records a guard, and nothing else — both surfaces run the same validation,
 * the same confirmation step and the same check-in call.
 */
export type CheckInMode = "kiosk" | "guard";

const COPY = {
  kiosk: {
    title: "Check in",
    subtitle: "Scan your appointment QR or visitor pass",
    manualLabel: "Or enter your appointment reference number",
    confirmTitle: "Is this you?",
    confirmSubtitle: "Please confirm your details to finish checking in",
    confirmAction: "Yes, check me in",
    rejectAction: "That's not me",
    pickTitle: "Which appointment?",
    pickSubtitle: "You have more than one appointment now. Choose the one you are here for.",
    doneTitle: "You're checked in!",
    againAction: "Check in another visitor",
  },
  guard: {
    title: "Scan a visitor in",
    subtitle: "Scan the visitor's appointment QR or visitor pass",
    manualLabel: "Or type their appointment reference number",
    confirmTitle: "Confirm this check-in",
    confirmSubtitle: "Check the details against the visitor in front of you",
    confirmAction: "Check in visitor",
    rejectAction: "Cancel",
    pickTitle: "Which appointment?",
    pickSubtitle: "This visitor has more than one appointment now. Choose one.",
    doneTitle: "Checked in",
    againAction: "Scan the next visitor",
  },
} as const satisfies Record<CheckInMode, Record<string, string>>;

/**
 * Visitor passes read `vp1.<id>.<mac>` (see `src/lib/pass-token.ts`). Checked
 * here by prefix only — importing that module would pull `node:crypto` into
 * the browser — and every decision is the server's.
 */
const PASS_PREFIX = "vp1.";

type Holder = { firstName: string; lastName: string };
type Choice = {
  hostId: string;
  hostName: string;
  hostDepartment: string;
  purposeId: string;
  purposeLabel: string;
};
type WalkInOptions = {
  notice: string | null;
  choices: Choice[];
  hosts: { id: string; name: string; department: string }[];
  purposes: { id: string; label: string }[];
};

const inputClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white";
const errorInputClass = inputClass.replace(
  "border-gray-300",
  "border-red-400",
);
const primaryButtonClass =
  "w-full min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300";
const secondaryButtonClass =
  "w-full min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
const cardButtonClass =
  "w-full rounded-lg border-2 border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: SITE_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Why a code was refused, worded by the server (`describeAppointmentFailure()`
 * or `PASS_FAILURE_MESSAGE`) so every surface says the same thing.
 *
 * At the kiosk the visitor is alone with the screen, so every refusal ends with
 * a way forward. The guard's scanner leaves it off: they are the help. Messages
 * that already say so are not told twice.
 */
function ErrorNotice({ message, mode }: { message: string; mode: CheckInMode }) {
  const saysSo = /ask the guard/i.test(message);

  return (
    <div
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
    >
      <p>{message}</p>
      {mode === "kiosk" && !saysSo && (
        <p className="mt-1 font-semibold">Ask the guard for help.</p>
      )}
    </div>
  );
}

/**
 * Scan or type a code, confirm who it belongs to, check them in.
 *
 * One component for the kiosk and the guard's scanner, and for both kinds of
 * code. An appointment QR (or reference) goes straight to "Is this you?". A
 * visitor pass resolves to its holder's appointments that can be checked into
 * now: one goes to the same confirmation, several to a picker, none to an
 * express walk-in with the holder's name filled in and their recent
 * host + purpose combinations one tap away.
 *
 * Every decision about whether a code may be used is made server-side; nothing
 * here re-implements any part of it.
 */
export function AppointmentCheckIn({ mode }: { mode: CheckInMode }) {
  const copy = COPY[mode];

  const [stage, setStage] = useState<Stage>("capture");
  const [reference, setReference] = useState("");
  const [appointment, setAppointment] = useState<ValidatedAppointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Set while a scanned pass is driving the flow; sent with the check-in. */
  const [passToken, setPassToken] = useState<string | null>(null);
  const [holder, setHolder] = useState<Holder | null>(null);
  const [options, setOptions] = useState<ValidatedAppointment[]>([]);
  const [walkIn, setWalkIn] = useState<WalkInOptions | null>(null);
  const [otherHost, setOtherHost] = useState("");
  const [otherPurpose, setOtherPurpose] = useState("");
  const [done, setDone] = useState<{ name: string; hostName: string } | null>(null);

  function reset() {
    setStage("capture");
    setReference("");
    setAppointment(null);
    setError(null);
    setPassToken(null);
    setHolder(null);
    setOptions([]);
    setWalkIn(null);
    setOtherHost("");
    setOtherPurpose("");
    setDone(null);
  }

  async function postJson(url: string, body: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, data: await response.json().catch(() => null) };
  }

  /** A scanned visitor pass: find what its holder can check into now. */
  async function resolvePass(token: string) {
    const { response, data } = await postJson("/api/passes/resolve", { token });

    if (!response.ok) {
      setError(apiErrorMessage(data?.error) ?? "This pass is no longer valid. Please ask the guard for help.");
      return;
    }

    setPassToken(token.trim());
    setHolder(data.holder as Holder);

    const found = data.appointments as ValidatedAppointment[];

    if (found.length === 1) {
      setAppointment(found[0]);
      setStage("confirm");
    } else if (found.length > 1) {
      setOptions(found);
      setStage("pick");
    } else {
      setWalkIn({
        notice: data.notice ?? null,
        choices: data.choices ?? [],
        hosts: data.hosts ?? [],
        purposes: data.purposes ?? [],
      });
      setStage("walk-in");
    }
  }

  /**
   * The one path into the next step, whether the code arrived from the camera
   * or the keypad — so a scanned code and a typed one are checked identically.
   */
  async function validate(token: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (token.trim().startsWith(PASS_PREFIX)) {
        await resolvePass(token);
        return;
      }

      const { response, data } = await postJson("/api/appointments/validate", { token });

      if (!response.ok) {
        setError(apiErrorMessage(data?.error) ?? "We could not find that appointment.");
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
      const { response, data } = await postJson("/api/appointments/check-in", {
        // The reference number is re-sent rather than a scanned token: it
        // resolves to the same appointment, and keeps the bearer token out of
        // a second request. A pass is re-sent so the server can re-check it and
        // record the visit as a pass check-in.
        token: appointment.referenceNumber,
        assisted: mode === "guard",
        ...(passToken ? { passToken } : {}),
      });

      if (!response.ok) {
        // Someone redeemed it between the scan and the confirm — send them back
        // to the start rather than leaving a dead button on screen.
        setError(apiErrorMessage(data?.error) ?? "Could not complete check-in.");
        setStage("capture");
        setAppointment(null);
        setPassToken(null);
        return;
      }

      setDone({
        name: formatFullName(appointment.firstName, appointment.lastName),
        hostName: appointment.hostName,
      });
      setStage("done");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function expressWalkIn(hostId: string, purposeId: string, hostName: string) {
    if (!passToken || busy) return;

    setBusy(true);
    setError(null);

    try {
      const { response, data } = await postJson("/api/passes/walk-in", {
        token: passToken,
        hostId,
        purposeId,
        assisted: mode === "guard",
      });

      if (!response.ok) {
        setError(apiErrorMessage(data?.error) ?? "Could not complete check-in.");
        return;
      }

      setDone({ name: formatFullName(data.firstName, data.lastName), hostName });
      setStage("done");
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "done" && done) {
    return (
      <div className="space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {copy.doneTitle}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {mode === "kiosk"
              ? `Welcome, ${done.name}. Please take a seat — reception can see you’ve arrived and will let ${done.hostName} know.`
              : `${done.name} is checked in. Please let ${done.hostName} know they’ve arrived.`}
          </p>
        </div>

        <button type="button" onClick={reset} className={primaryButtonClass}>
          {copy.againAction}
        </button>
      </div>
    );
  }

  if (stage === "pick") {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {copy.pickTitle}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {holder ? `${formatFullName(holder.firstName, holder.lastName)} · ` : ""}
            {copy.pickSubtitle}
          </p>
        </div>

        <div className="space-y-2">
          {options.map((option) => (
            <button
              key={option.referenceNumber}
              type="button"
              onClick={() => {
                setAppointment(option);
                setStage("confirm");
              }}
              className={cardButtonClass}
            >
              <span className="block text-sm font-semibold text-gray-900 dark:text-white" suppressHydrationWarning>
                {formatWhen(option.scheduledFor)}
              </span>
              <span className="block text-sm text-gray-700 dark:text-gray-200">
                {option.hostName} · {option.hostDepartment}
              </span>
              {option.purposeLabel && (
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {option.purposeLabel}
                </span>
              )}
            </button>
          ))}
        </div>

        <button type="button" onClick={reset} className={secondaryButtonClass}>
          {copy.rejectAction}
        </button>
      </div>
    );
  }

  if (stage === "walk-in" && walkIn && holder) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            No appointment today
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            You can still check in as a walk-in — it takes one tap.
          </p>
        </div>

        {walkIn.notice && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {walkIn.notice}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400" htmlFor="pass-first-name">
              First name
            </label>
            <input id="pass-first-name" readOnly autoComplete="off" value={holder.firstName} className={`${inputClass} bg-gray-50 dark:bg-gray-800`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400" htmlFor="pass-last-name">
              Last name
            </label>
            <input id="pass-last-name" readOnly autoComplete="off" value={holder.lastName} className={`${inputClass} bg-gray-50 dark:bg-gray-800`} />
          </div>
        </div>

        {walkIn.choices.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Same as last time</p>
            {walkIn.choices.map((choice) => (
              <button
                key={`${choice.hostId}|${choice.purposeId}`}
                type="button"
                disabled={busy}
                onClick={() => void expressWalkIn(choice.hostId, choice.purposeId, choice.hostName)}
                className={cardButtonClass}
              >
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                  {choice.hostName}
                  <span className="font-normal text-gray-500 dark:text-gray-400"> · {choice.hostDepartment}</span>
                </span>
                <span className="block text-sm text-gray-600 dark:text-gray-300">{choice.purposeLabel}</span>
              </button>
            ))}
          </div>
        )}

        <form
          className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
          onSubmit={(event) => {
            event.preventDefault();
            const host = walkIn.hosts.find((option) => option.id === otherHost);
            if (!host || !otherPurpose) {
              setError("Please choose who you are visiting and why.");
              return;
            }
            void expressWalkIn(host.id, otherPurpose, host.name);
          }}
        >
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {walkIn.choices.length > 0 ? "Somewhere else this time?" : "Who are you visiting?"}
          </p>
          <select
            autoComplete="off"
            aria-label="Host"
            value={otherHost}
            onChange={(event) => setOtherHost(event.target.value)}
            className={inputClass}
          >
            <option value="">Select who you are visiting…</option>
            {walkIn.hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name} — {host.department}
              </option>
            ))}
          </select>
          <select
            autoComplete="off"
            aria-label="Purpose"
            value={otherPurpose}
            onChange={(event) => setOtherPurpose(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a purpose…</option>
            {walkIn.purposes.map((purpose) => (
              <option key={purpose.id} value={purpose.id}>
                {purpose.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? "Checking in…" : "Check in"}
          </button>
        </form>

        {error && <ErrorNotice message={error} mode={mode} />}

        <button type="button" onClick={reset} disabled={busy} className={secondaryButtonClass}>
          {copy.rejectAction}
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

        {error && <ErrorNotice message={error} mode={mode} />}

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

      {/* Released while a later step is up, and restarted if the visitor is
          sent back here. */}
      <QrScanner active={stage === "capture" && !busy} onScan={validate} />

      {error && <ErrorNotice message={error} mode={mode} />}

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
