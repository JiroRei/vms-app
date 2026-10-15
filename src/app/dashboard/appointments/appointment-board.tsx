"use client";
import { apiErrorMessage } from "@/lib/api-error-message";


import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { TimelineChevron } from "@/components/visit-timeline";
import { useToast } from "@/components/toast";
import type {
  AppointmentEventRecord,
  AppointmentListItem,
  StaffAppointmentLists,
} from "@/lib/appointments";
import {
  BOOKING_TIMEZONE,
  formatZonedTime,
  toDateTimeLocalInZone,
} from "@/lib/booking-config";
import { formatFullName } from "@/lib/names";

type Tab = "today" | "upcoming";

/** "Thu, Oct 15" on the building's clock, for the Upcoming tab. */
const shortDate = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Oct 15, 3:00 PM" on the building's clock, for the event log. */
const stamp = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const smallButton =
  "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const neutralButton = `${smallButton} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700`;
const inputClass =
  "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white";

/** The badge for a row: where the appointment stands right now. */
function statusBadge(
  item: AppointmentListItem,
  nowMs: number,
): { label: string; className: string } {
  if (item.status === "CHECKED_IN") {
    return {
      label: item.checkedInAt
        ? `Checked in ${formatZonedTime(new Date(item.checkedInAt))}`
        : "Checked in",
      className: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    };
  }

  if (item.status === "CANCELLED") {
    return {
      label: item.cancelledBy === "VISITOR" ? "Cancelled by visitor" : "Cancelled",
      className: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    };
  }

  if (!item.open) {
    return {
      label: "Expired",
      className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    };
  }

  if (new Date(item.scheduledFor).getTime() < nowMs) {
    return {
      label: "Late",
      className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    };
  }

  return {
    label: "Expected",
    className: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  };
}

const EVENT_LABEL: Record<AppointmentEventRecord["type"], string> = {
  CREATED: "Booked",
  RESCHEDULED: "Rescheduled",
  CANCELLED: "Cancelled",
  QR_REGENERATED: "New QR code issued",
  CHECKED_IN: "Checked in",
};

function actorLabel(event: AppointmentEventRecord): string {
  if (event.actorType === "STAFF") return event.actorName ?? "Staff (account removed)";
  if (event.actorType === "VISITOR") return "Visitor";
  return "System";
}

/** The one line of old → new a guard needs from an event's `detail`. */
function eventDetail(event: AppointmentEventRecord): string | null {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  const from = (detail.from ?? {}) as Record<string, unknown>;
  const to = (detail.to ?? {}) as Record<string, unknown>;

  if (event.type === "RESCHEDULED" && typeof from.scheduledFor === "string" && typeof to.scheduledFor === "string") {
    return `${stamp.format(new Date(from.scheduledFor))} → ${stamp.format(new Date(to.scheduledFor))}`;
  }

  if (event.type === "CREATED" && typeof detail.scheduledFor === "string") {
    return `for ${stamp.format(new Date(detail.scheduledFor))}${detail.backfilled ? " · reconstructed" : ""}`;
  }

  if (event.type === "CANCELLED" && typeof detail.reason === "string" && detail.reason) {
    return `“${detail.reason}”`;
  }

  if (event.type === "QR_REGENERATED") return "previous code revoked";

  return null;
}

/**
 * Today's and the next two weeks' appointments — the guards' expected-arrivals
 * view — with the row actions a desk needs.
 *
 * Every action goes to the server and then refreshes the list from it, so what
 * the guard sees is always what the database says. Whether a check-in is
 * allowed right now (too early, wrong day) is decided by the same rule the
 * kiosk uses, and its message is shown as is.
 */
export function AppointmentBoard({ lists }: { lists: StaffAppointmentLists }) {
  const router = useRouter();
  const showToast = useToast();

  const [tab, setTab] = useState<Tab>("today");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Which row has an inline form open, and which form. */
  const [editing, setEditing] = useState<{ id: string; kind: "reschedule" | "cancel" | "regenerate" } | null>(null);
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Read once per render for badges; the list itself refreshes on every action.
  const [nowMs] = useState(() => Date.now());

  const rows = lists[tab];
  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (item) =>
          item.referenceNumber.toLowerCase().includes(q) ||
          formatFullName(item.firstName, item.lastName).toLowerCase().includes(q),
      )
    : rows;

  async function act(
    item: AppointmentListItem,
    path: string,
    init: RequestInit,
    success: (data: Record<string, unknown>) => string,
  ) {
    setBusyId(item.id);

    try {
      const response = await fetch(
        `/api/appointments/manage/${encodeURIComponent(item.referenceNumber)}${path}`,
        { headers: { "Content-Type": "application/json" }, ...init },
      );
      const data = (await response.json().catch(() => null)) ?? {};

      if (!response.ok) {
        showToast(
          response.status === 401
            ? "Your session has ended. Please sign in again."
            : (data.fieldErrors?.scheduledFor ?? apiErrorMessage(data.error) ?? "That did not work."),
          "error",
        );
        return;
      }

      showToast(success(data));
      setEditing(null);
    } catch {
      showToast("Could not reach the server. Please try again.", "error");
    } finally {
      setBusyId(null);
      router.refresh();
    }
  }

  const name = (item: AppointmentListItem) => formatFullName(item.firstName, item.lastName);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Appointments" className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800">
          {(["today", "upcoming"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                setExpandedId(null);
                setEditing(null);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {key === "today" ? "Today" : "Upcoming · 14 days"}{" "}
              <span className="opacity-75">({lists[key].length})</span>
            </button>
          ))}
        </div>

        <input
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or reference"
          aria-label="Search appointments by name or reference"
          className={`${inputClass} w-full sm:w-64`}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {visible.length === 0 ? (
          <EmptyState
            title={q ? "No appointments match" : tab === "today" ? "Nobody expected today" : "Nothing booked in the next 14 days"}
            hint={q ? "Try part of a name, or the reference number (APT-…)." : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
                  <th scope="col" className="px-4 py-3">{tab === "today" ? "Time" : "When"}</th>
                  <th scope="col" className="px-4 py-3">Visitor</th>
                  <th scope="col" className="px-4 py-3">Host</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visible.map((item) => {
                  const expanded = expandedId === item.id;
                  const badge = statusBadge(item, nowMs);
                  const scheduled = new Date(item.scheduledFor);
                  const busy = busyId === item.id;
                  const edit = editing?.id === item.id ? editing.kind : null;

                  return (
                    <Fragment key={item.id}>
                      <tr className="align-top">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-900 dark:text-white">
                          {tab === "upcoming" || item.dayKey !== lists.todayKey ? (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                              {shortDate.format(scheduled)}
                            </span>
                          ) : null}
                          <span className="font-semibold">{formatZonedTime(scheduled)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : item.id)}
                            aria-expanded={expanded}
                            aria-controls={`appointment-log-${item.id}`}
                            className="flex items-center gap-1 text-left font-medium text-gray-900 hover:underline dark:text-white"
                          >
                            <TimelineChevron open={expanded} />
                            {name(item)}
                          </button>
                          <code className="ml-5 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {item.referenceNumber}
                          </code>
                          {item.purposeLabel && (
                            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">· {item.purposeLabel}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-gray-900 dark:text-white">{item.hostName}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{item.hostDepartment}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {item.open && !edit && (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void act(item, "/check-in", { method: "POST" }, () => `${name(item)} is checked in.`)
                                }
                                className={`${smallButton} border-blue-600 bg-blue-600 text-white hover:bg-blue-500`}
                              >
                                {busy ? "Working…" : "Check in"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setEditing({ id: item.id, kind: "reschedule" });
                                  setNewTime(toDateTimeLocalInZone(scheduled));
                                }}
                                className={neutralButton}
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setEditing({ id: item.id, kind: "cancel" });
                                  setReason("");
                                }}
                                className={neutralButton}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setEditing({ id: item.id, kind: "regenerate" })}
                                className={neutralButton}
                              >
                                Regenerate QR
                              </button>
                            </div>
                          )}

                          {edit === "reschedule" && (
                            <form
                              className="flex flex-wrap items-center justify-end gap-1.5"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void act(
                                  item,
                                  "/reschedule",
                                  {
                                    method: "POST",
                                    // The field is wall-clock time in the
                                    // building's zone; the server gets an instant.
                                    body: JSON.stringify({ scheduledFor: newTime ? `${newTime}:00${zoneOffset(newTime)}` : "" }),
                                  },
                                  (data) =>
                                    `Moved to ${stamp.format(new Date(String(data.scheduledFor)))}. The visitor has been emailed; their QR code is unchanged.`,
                                );
                              }}
                            >
                              <label className="sr-only" htmlFor={`new-time-${item.id}`}>New time</label>
                              <input
                                id={`new-time-${item.id}`}
                                type="datetime-local"
                                autoComplete="off"
                                required
                                value={newTime}
                                onChange={(event) => setNewTime(event.target.value)}
                                className={inputClass}
                              />
                              <button type="submit" disabled={busy} className={`${smallButton} border-blue-600 bg-blue-600 text-white hover:bg-blue-500`}>
                                {busy ? "Saving…" : "Save"}
                              </button>
                              <button type="button" onClick={() => setEditing(null)} className={neutralButton}>
                                Back
                              </button>
                            </form>
                          )}

                          {edit === "cancel" && (
                            <form
                              className="flex flex-wrap items-center justify-end gap-1.5"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void act(
                                  item,
                                  "",
                                  { method: "DELETE", body: JSON.stringify({ reason }) },
                                  () => `Cancelled ${item.referenceNumber}. The visitor has been emailed.`,
                                );
                              }}
                            >
                              <label className="sr-only" htmlFor={`reason-${item.id}`}>Reason (optional)</label>
                              <input
                                id={`reason-${item.id}`}
                                autoComplete="off"
                                maxLength={300}
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Reason (optional)"
                                className={`${inputClass} w-44`}
                              />
                              <button type="submit" disabled={busy} className={`${smallButton} border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300`}>
                                {busy ? "Cancelling…" : "Yes, cancel"}
                              </button>
                              <button type="button" onClick={() => setEditing(null)} className={neutralButton}>
                                Keep
                              </button>
                            </form>
                          )}

                          {edit === "regenerate" && (
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <span className="text-xs text-gray-600 dark:text-gray-300">
                                The current code stops working.
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void act(item, "/regenerate-qr", { method: "POST" }, (data) =>
                                    data.emailSent
                                      ? "New QR code issued and emailed. The old code no longer works."
                                      : `New QR code issued, but the email could not be sent. Give them ${item.referenceNumber} — it still works.`,
                                  )
                                }
                                className={`${smallButton} border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300`}
                              >
                                {busy ? "Issuing…" : "Issue new code"}
                              </button>
                              <button type="button" onClick={() => setEditing(null)} className={neutralButton}>
                                Back
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="bg-gray-50 dark:bg-gray-900/40">
                          <td id={`appointment-log-${item.id}`} colSpan={5} className="px-4 py-4 pl-9">
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              Appointment history · {item.visitorEmail}
                            </h3>
                            {item.events.length === 0 ? (
                              <p className="text-sm text-gray-500 dark:text-gray-400">No changes recorded.</p>
                            ) : (
                              <ol className="ml-1 space-y-2 border-l border-gray-200 dark:border-gray-600">
                                {item.events.map((event) => {
                                  const detail = eventDetail(event);
                                  return (
                                    <li key={event.id} className="relative pl-5 text-sm">
                                      <span aria-hidden className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-gray-400 ring-2 ring-white dark:ring-gray-800" />
                                      <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                                        {stamp.format(new Date(event.createdAt))}
                                      </span>
                                      <span className="text-gray-400"> — </span>
                                      <span className="text-gray-700 dark:text-gray-200">{EVENT_LABEL[event.type]}</span>
                                      <span className="text-gray-500 dark:text-gray-400"> by {actorLabel(event)}</span>
                                      {detail && (
                                        <span className="block text-xs text-gray-500 dark:text-gray-400">{detail}</span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ol>
                            )}
                            {item.cancelReason && item.status === "CANCELLED" && (
                              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Cancel reason: {item.cancelReason}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The building zone's UTC offset at a wall-clock time, as `+08:00`, so a
 * `datetime-local` value is read on the building's clock rather than the
 * guard's device's.
 */
function zoneOffset(local: string): string {
  const [date, time] = local.split("T");
  const asUtc = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIMEZONE,
    timeZoneName: "longOffset",
  }).formatToParts(asUtc);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = name.replace("GMT", "");
  return offset === "" ? "Z" : offset;
}
