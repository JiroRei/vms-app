"use client";
import { apiErrorMessage } from "@/lib/api-error-message";


import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AppointmentStatus, CancelledBy } from "@/generated/prisma/enums";
import {
  BOOKING_TIMEZONE_LABEL,
  formatZonedDate,
  formatZonedTime,
  SLOT_MINUTES,
  toSlotValue,
} from "@/lib/booking-config";
import { buildIcs } from "@/lib/ics";
import { formatFullName } from "@/lib/names";

import { DateTimePicker, type SlotValue } from "../date-time-picker";
import { ReturningLookup } from "../returning-lookup";
import {
  errorClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  textButtonClass,
} from "../styles";

/** One appointment as the visitor's own page shows it. */
export type ManagedAppointment = {
  referenceNumber: string;
  firstName: string;
  lastName: string;
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  scheduledFor: string;
  /** PENDING here means still usable; a lapsed PENDING arrives as EXPIRED. */
  status: AppointmentStatus;
  cancelledBy: CancelledBy | null;
  checkedInAt: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  /** Only for a usable appointment; null otherwise or if rendering failed. */
  qrDataUrl: string | null;
};

/** The signed-in visitor's pass, rendered server-side from its current version. */
export type MyPass = {
  qrDataUrl: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type Mode = "link" | "invalid-link" | "signed-in" | "sign-in";

/** "Thursday, October 15 at 3:00 PM", on the building's clock. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  return `${formatZonedDate(date)} at ${formatZonedTime(date)}`;
}

const STATUS_BADGE: Record<AppointmentStatus, { label: string; className: string }> = {
  PENDING: { label: "Confirmed", className: "bg-green-50 text-green-800" },
  CHECKED_IN: { label: "Checked in", className: "bg-blue-50 text-blue-800" },
  CANCELLED: { label: "Cancelled", className: "bg-red-50 text-red-800" },
  EXPIRED: { label: "Expired", className: "bg-gray-100 text-gray-700" },
};

export function ManageView({
  mode,
  token,
  email,
  appointments,
  myPass = null,
}: {
  mode: Mode;
  /** The manage-link token, sent back with every change. Null when signed in. */
  token: string | null;
  email?: string;
  appointments: ManagedAppointment[];
  /** Only ever set in "signed-in" mode. */
  myPass?: MyPass | null;
}) {
  const router = useRouter();

  if (mode === "sign-in" || mode === "invalid-link") {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Manage your appointment
            </h1>
            {mode === "invalid-link" ? (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
              >
                This link is invalid or has expired. Sign in below to see your
                appointments, or use the link in your most recent email.
              </p>
            ) : (
              <p className="mt-2 text-base text-gray-600">
                Sign in with the email and name you booked with. We&rsquo;ll
                email you a code.
              </p>
            )}
          </div>

          <ReturningLookup
            initialEmail=""
            initialFirstName=""
            initialLastName=""
            onVerified={() => {
              // The verify call set the cookie; drop any dead token from the
              // URL and let the server render the list.
              router.replace("/appointment-booking/manage");
              router.refresh();
            }}
          />
        </div>
      </div>
    );
  }

  async function signOut() {
    await fetch("/api/booking/sign-out", { method: "POST" }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {mode === "link" ? "Your appointment" : "Your appointments"}
        </h1>
        {mode === "signed-in" && (
          <p className="text-sm text-gray-600">
            {email} ·{" "}
            <button type="button" onClick={() => void signOut()} className={textButtonClass}>
              Sign out
            </button>
          </p>
        )}
      </div>

      {mode === "signed-in" && myPass && (
        <PassSection pass={myPass} onReplaced={() => router.refresh()} />
      )}

      {appointments.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base text-gray-700">You have no upcoming appointments.</p>
        </div>
      ) : (
        appointments.map((appointment) => (
          <AppointmentCard
            key={appointment.referenceNumber}
            appointment={appointment}
            token={token}
            onChanged={() => router.refresh()}
          />
        ))
      )}
    </div>
  );
}

/** "My pass": the QR, a download, and "Replace my pass". */
function PassSection({ pass, onReplaced }: { pass: MyPass; onReplaced: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function replace() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/booking/pass/rotate", { method: "POST" });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(apiErrorMessage(data?.error) ?? "Could not replace your pass.");
        return;
      }

      setConfirming(false);
      setNotice("Done. Your old pass no longer works — use this new one. We've emailed it to you too.");
      onReplaced();
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="my-pass-heading"
      className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div>
        <h2 id="my-pass-heading" className="text-lg font-semibold text-gray-900">
          My pass
        </h2>
        <p className="text-sm text-gray-600">
          Show this at the kiosk or gate to check in faster — with or without an
          appointment. Anyone holding it can check in as you, so keep it to yourself.
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900">
          {notice}
        </p>
      )}

      <Image
        src={pass.qrDataUrl}
        alt="Your visitor pass QR code"
        width={280}
        height={280}
        unoptimized
        className="mx-auto rounded-lg border border-gray-200"
      />
      <p className="text-center text-xs text-gray-500">
        Valid until {formatZonedDate(new Date(pass.expiresAt))} — renewed every time you use it.
      </p>

      {!confirming ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={pass.qrDataUrl} download="visitor-pass.png" className={secondaryButtonClass}>
            Download image
          </a>
          <button type="button" onClick={() => setConfirming(true)} className={secondaryButtonClass}>
            Replace my pass
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            Replace your pass? The current QR — including any copy you saved or
            printed — stops working straight away.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className={`${secondaryButtonClass} flex-1`}
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void replace()}
              className={`${primaryButtonClass} flex-1`}
            >
              {busy ? "Replacing…" : "Yes, replace"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </section>
  );
}

function downloadIcs(appointment: ManagedAppointment) {
  const ics = buildIcs({
    uid: `${appointment.referenceNumber}@vms`,
    start: new Date(appointment.scheduledFor),
    durationMinutes: SLOT_MINUTES,
    title: `Visit: ${appointment.hostName}`,
    description: [
      `Visiting ${appointment.hostName} (${appointment.hostDepartment})`,
      ...(appointment.purposeLabel ? [`Purpose: ${appointment.purposeLabel}`] : []),
      `Reference number: ${appointment.referenceNumber}`,
      "Show your QR code at the kiosk or to the guard on arrival.",
    ].join("\n"),
  });

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${appointment.referenceNumber}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function AppointmentCard({
  appointment,
  token,
  onChanged,
}: {
  appointment: ManagedAppointment;
  token: string | null;
  onChanged: () => void;
}) {
  const [stage, setStage] = useState<"view" | "reschedule" | "cancel">("view");
  const [slot, setSlot] = useState<SlotValue>({ date: null, time: null });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const badge = STATUS_BADGE[appointment.status];
  const base = `/api/booking/appointments/${encodeURIComponent(appointment.referenceNumber)}`;

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, data };
  }

  async function submitReschedule() {
    if (busy) return;

    if (!slot.date || !slot.time) {
      setError("Please choose a new date and time.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { ok, data } = await post("reschedule", {
        scheduledFor: toSlotValue(slot.date, slot.time),
      });

      if (!ok) {
        setError(data?.fieldErrors?.scheduledFor ?? apiErrorMessage(data?.error) ?? "Could not reschedule.");
        return;
      }

      setStage("view");
      setNotice(
        `Moved to ${formatWhen(data.scheduledFor)}. Your QR code and reference number have not changed. We've emailed you the updated details.`,
      );
      onChanged();
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const { ok, data } = await post("cancel", { reason });

      if (!ok) {
        setError(apiErrorMessage(data?.error) ?? "Could not cancel.");
        return;
      }

      setStage("view");
      setNotice("Your appointment is cancelled. Its QR code no longer works.");
      onChanged();
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-gray-900">
            {formatWhen(appointment.scheduledFor)}
          </p>
          <p className="text-sm text-gray-600">{BOOKING_TIMEZONE_LABEL}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {notice && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900">
          {notice}
        </p>
      )}

      <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-sm text-gray-500">Name</dt>
          <dd className="text-right text-sm font-semibold text-gray-900">
            {formatFullName(appointment.firstName, appointment.lastName)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-sm text-gray-500">Visiting</dt>
          <dd className="text-right text-sm text-gray-900">
            {appointment.hostName}
            <span className="block text-xs text-gray-500">{appointment.hostDepartment}</span>
          </dd>
        </div>
        {appointment.purposeLabel && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Purpose</dt>
            <dd className="text-right text-sm text-gray-900">{appointment.purposeLabel}</dd>
          </div>
        )}
        {appointment.status === "CHECKED_IN" && appointment.checkedInAt && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Checked in</dt>
            <dd className="text-right text-sm text-gray-900">
              {formatWhen(appointment.checkedInAt)}
            </dd>
          </div>
        )}
        {appointment.status === "CANCELLED" && (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-gray-500">Cancelled</dt>
            <dd className="text-right text-sm text-gray-900">
              {appointment.cancelledBy === "VISITOR" ? "By you" : "By reception"}
            </dd>
          </div>
        )}
      </dl>

      <div className="rounded-xl border border-gray-200 p-5 text-center">
        {appointment.qrDataUrl && (
          <Image
            src={appointment.qrDataUrl}
            alt={`QR code for appointment ${appointment.referenceNumber}`}
            width={280}
            height={280}
            unoptimized
            className="mx-auto rounded-lg border border-gray-200"
          />
        )}
        <p className="mt-4 text-xs font-medium uppercase tracking-widest text-gray-500">
          Reference number
        </p>
        <p className="mt-1 text-3xl font-bold tracking-widest text-gray-900">
          {appointment.referenceNumber}
        </p>
        {appointment.qrDataUrl && (
          <p className="mt-2 text-sm text-gray-500">
            Show the code at the kiosk or to the guard, or type the reference number.
          </p>
        )}
      </div>

      {stage === "reschedule" && (
        <div className="space-y-4 border-t border-gray-200 pt-5">
          <h2 className="text-lg font-semibold text-gray-900">Choose a new time</h2>
          <DateTimePicker
            value={slot}
            onChange={(next) => {
              setSlot(next);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setStage("view");
                setError(null);
              }}
              className={secondaryButtonClass}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitReschedule()}
              className={`${primaryButtonClass} flex-1`}
            >
              {busy ? "Saving…" : "Save new time"}
            </button>
          </div>
        </div>
      )}

      {stage === "view" && (
        <div className="grid gap-2 sm:grid-cols-3">
          {appointment.status === "PENDING" && (
            <button
              type="button"
              onClick={() => downloadIcs(appointment)}
              className={secondaryButtonClass}
            >
              Add to calendar
            </button>
          )}
          {appointment.canReschedule && (
            <button
              type="button"
              onClick={() => {
                setStage("reschedule");
                setNotice(null);
                setError(null);
              }}
              className={secondaryButtonClass}
            >
              Reschedule
            </button>
          )}
          {appointment.canCancel && (
            <button
              type="button"
              onClick={() => {
                setStage("cancel");
                setNotice(null);
                setError(null);
              }}
              className={`${secondaryButtonClass} text-red-700`}
            >
              Cancel visit
            </button>
          )}
        </div>
      )}

      {stage === "cancel" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`cancel-${appointment.referenceNumber}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2
              id={`cancel-${appointment.referenceNumber}`}
              className="text-lg font-semibold text-gray-900"
            >
              Cancel this visit?
            </h2>
            <p className="text-sm text-gray-600">
              {formatWhen(appointment.scheduledFor)} with {appointment.hostName}. Your QR
              code will stop working. This cannot be undone — you would need to book again.
            </p>
            <div>
              <label htmlFor={`reason-${appointment.referenceNumber}`} className={labelClass}>
                Reason <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <textarea
                id={`reason-${appointment.referenceNumber}`}
                autoComplete="off"
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:outline-2 focus:outline-accent"
              />
            </div>
            {error && (
              <p role="alert" className={errorClass}>
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStage("view");
                  setError(null);
                }}
                className={`${secondaryButtonClass} flex-1`}
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitCancel()}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-red-600 px-5 text-base font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "view" && error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </article>
  );
}
