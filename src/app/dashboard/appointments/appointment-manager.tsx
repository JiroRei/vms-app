"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/dates";
import type { AppointmentListItem } from "@/lib/appointments";
import type { HostOption } from "@/lib/visits";

const controlClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorClass = "mt-1 text-sm text-red-600 dark:text-red-400";

type FieldName = "visitorName" | "purpose" | "hostId" | "scheduledFor";
type FieldErrors = Partial<Record<FieldName, string>>;

/** The order fields appear in, so a failed submit focuses the topmost one. */
const FIELD_ORDER: FieldName[] = [
  "visitorName",
  "purpose",
  "hostId",
  "scheduledFor",
];

function focusFirstError(errors: FieldErrors) {
  const first = FIELD_ORDER.find((field) => errors[field]);
  if (first) document.getElementById(first)?.focus();
}

export function AppointmentManager({
  appointments,
  hosts,
}: {
  appointments: AppointmentListItem[];
  hosts: HostOption[];
}) {
  const router = useRouter();

  const [visitorName, setVisitorName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [hostId, setHostId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * The reference the last submit produced. This is the whole point of the
   * form — the visitor cannot check in without it — so it stays on screen
   * until the receptionist starts another one, rather than flashing past as a
   * toast.
   */
  const [created, setCreated] = useState<AppointmentListItem | null>(null);
  const [copied, setCopied] = useState(false);

  const [showUsed, setShowUsed] = useState(false);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const visible = showUsed
    ? appointments
    : appointments.filter((appointment) => !appointment.used);
  const usedCount = appointments.filter((a) => a.used).length;

  /** Drops a field's complaint as soon as it is being corrected. */
  function clearError(field: FieldName) {
    setFormError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};

    if (!visitorName.trim()) {
      errors.visitorName = "Please enter the visitor's name.";
    }
    if (!purpose.trim()) {
      errors.purpose = "Please enter the purpose of the visit.";
    }
    if (!hostId) {
      errors.hostId = "Please choose who they are here to see.";
    }

    return errors;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Guards a double-submit landing before React re-renders the disabled
    // button — the same pattern the kiosk forms use.
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorName: visitorName.trim(),
          purpose: purpose.trim(),
          hostId,
          // `datetime-local` gives a wall-clock string with no zone; letting
          // Date read it as local time and sending ISO is what keeps "2pm" 2pm.
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          const serverErrors = data.fieldErrors as FieldErrors;
          setFieldErrors(serverErrors);
          focusFirstError(serverErrors);
        } else if (response.status === 401) {
          setFormError("Your session has ended. Please sign in again.");
          router.refresh();
        } else {
          setFormError(data?.error ?? "Could not create this appointment.");
        }

        return;
      }

      const data = (await response.json()) as {
        appointment: AppointmentListItem;
      };

      setCreated(data.appointment);
      setCopied(false);
      setVisitorName("");
      setPurpose("");
      setHostId("");
      setScheduledFor("");
      // The list is server-rendered, so ask the server for it again rather
      // than splicing a row in and hoping the two agree.
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The reference is on screen
      // and selectable, so this is a convenience failing, not the task.
      setCopied(false);
    }
  }

  async function confirmCancel(reference: string) {
    setPendingRef(reference);
    setListError(null);

    try {
      const response = await fetch(`/api/appointments/${reference}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (response.status === 401) {
          setListError("Your session has ended. Please sign in again.");
        } else {
          setListError(data?.error ?? "Could not cancel this appointment.");
        }
      }
    } catch {
      setListError("Could not reach the server. Please try again.");
    } finally {
      setPendingRef(null);
      setCancellingRef(null);
      // Reconcile either way: on a 409 the row has been redeemed and should
      // now show as checked in rather than simply refusing to disappear.
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Create                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Pre-register a visitor
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Creates a reference number the visitor types in at the kiosk. It works
          once.
        </p>

        {created && (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-500/40 dark:bg-green-500/10">
            <p className="text-sm font-medium text-green-900 dark:text-green-200">
              {created.visitorName} is pre-registered. Send them this reference:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="rounded-md bg-white px-3 py-2 font-mono text-xl font-bold tracking-wider text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white">
                {created.referenceNumber}
              </code>
              <button
                type="button"
                onClick={() => void copyReference(created.referenceNumber)}
                className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-800 shadow-sm transition-colors hover:bg-green-100 dark:border-green-500/40 dark:bg-gray-800 dark:text-green-300 dark:hover:bg-green-500/20"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="visitorName" className={labelClass}>
                Visitor name
              </label>
              <input
                id="visitorName"
                value={visitorName}
                onChange={(event) => {
                  setVisitorName(event.target.value);
                  clearError("visitorName");
                }}
                className={controlClass}
                placeholder="Marcus Delgado"
                autoComplete="off"
                aria-describedby={
                  fieldErrors.visitorName ? "visitorName-error" : undefined
                }
              />
              {fieldErrors.visitorName && (
                <p id="visitorName-error" className={errorClass}>
                  {fieldErrors.visitorName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="purpose" className={labelClass}>
                Purpose
              </label>
              <input
                id="purpose"
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  clearError("purpose");
                }}
                className={controlClass}
                placeholder="Quarterly vendor review"
                autoComplete="off"
                aria-describedby={
                  fieldErrors.purpose ? "purpose-error" : undefined
                }
              />
              {fieldErrors.purpose && (
                <p id="purpose-error" className={errorClass}>
                  {fieldErrors.purpose}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="hostId" className={labelClass}>
                Host
              </label>
              <select
                id="hostId"
                value={hostId}
                onChange={(event) => {
                  setHostId(event.target.value);
                  clearError("hostId");
                }}
                className={controlClass}
                aria-describedby={
                  fieldErrors.hostId ? "hostId-error" : undefined
                }
              >
                <option value="">Select a host…</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name} — {host.department}
                  </option>
                ))}
              </select>
              {fieldErrors.hostId && (
                <p id="hostId-error" className={errorClass}>
                  {fieldErrors.hostId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="scheduledFor" className={labelClass}>
                Expected{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="scheduledFor"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => {
                  setScheduledFor(event.target.value);
                  clearError("scheduledFor");
                }}
                className={controlClass}
                aria-describedby={
                  fieldErrors.scheduledFor ? "scheduledFor-error" : undefined
                }
              />
              {fieldErrors.scheduledFor && (
                <p id="scheduledFor-error" className={errorClass}>
                  {fieldErrors.scheduledFor}
                </p>
              )}
            </div>
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {submitting ? "Creating…" : "Create appointment"}
          </button>
        </form>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* List                                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {visible.length === 0
              ? "Nothing to show"
              : `${visible.length} appointment${visible.length === 1 ? "" : "s"}`}
          </p>

          {usedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={showUsed}
                onChange={(event) => setShowUsed(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show checked in ({usedCount})
            </label>
          )}
        </div>

        {listError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {listError}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {visible.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No appointments waiting"
              hint="Pre-register a visitor above and give them the reference number. They type it in at the kiosk instead of filling in the walk-in form."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Reference
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Visitor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Host
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Expected
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {visible.map((appointment) => (
                    <tr key={appointment.id}>
                      <td className="px-4 py-3">
                        <code className="font-mono text-sm font-semibold text-gray-900 dark:text-white">
                          {appointment.referenceNumber}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {appointment.visitorName}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {appointment.purpose}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900 dark:text-white">
                          {appointment.hostName}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {appointment.hostDepartment}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {appointment.scheduledFor
                          ? formatDateTime(appointment.scheduledFor)
                          : "No time set"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {appointment.used ? (
                          <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            Checked in
                          </span>
                        ) : cancellingRef === appointment.referenceNumber ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              Cancel this?
                            </span>
                            <button
                              type="button"
                              disabled={pendingRef !== null}
                              onClick={() =>
                                void confirmCancel(appointment.referenceNumber)
                              }
                              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                            >
                              {pendingRef === appointment.referenceNumber
                                ? "Cancelling…"
                                : "Yes, cancel"}
                            </button>
                            <button
                              type="button"
                              disabled={pendingRef !== null}
                              onClick={() => setCancellingRef(null)}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setCancellingRef(appointment.referenceNumber)
                            }
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
