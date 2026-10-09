"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/components/toast";
import { VisitStatusBadge } from "@/components/visit-status-badge";
import { TimelineChevron, VisitTimeline } from "@/components/visit-timeline";
import { VisitorTypeBadge } from "@/components/visitor-type-badge";
import { formatFullName } from "@/lib/names";
import type { ActiveVisit } from "@/lib/visits";

const POLL_INTERVAL_MS = 5000;

/** How long a row stays highlighted after its action succeeded. */
const FLASH_MS = 1600;

/** The three row actions, and the endpoint each one posts to. */
type VisitAction = "checkout" | "step-out" | "return";

const ACTION_ERROR: Record<VisitAction, string> = {
  checkout: "Could not check out this visitor.",
  "step-out": "Could not mark this visitor as returning.",
  return: "Could not mark this visitor as returned.",
};

/** Past-tense confirmation for the toast, built from the visitor's name. */
const ACTION_DONE: Record<VisitAction, (name: string) => string> = {
  checkout: (name) => `${name} checked out`,
  "step-out": (name) => `${name} marked as returning`,
  return: (name) => `${name} marked as returned`,
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LiveCheckIns({
  initialVisits,
}: {
  initialVisits: ActiveVisit[];
}) {
  const showToast = useToast();
  const router = useRouter();

  const [visits, setVisits] = useState(initialVisits);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  /** Only the polling problem lives here; action failures go to a toast. */
  const [pollError, setPollError] = useState<string | null>(null);
  /** The row that just changed, highlighted briefly so the change is seen. */
  const [flashedId, setFlashedId] = useState<string | null>(null);
  /** The visit whose "will they return?" dialog is open, if any. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** The one row whose timeline is open. One at a time keeps the list short. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resolved from the current list rather than held as its own copy of the
  // visit, so a poll that checks the row out from under an open dialog — another
  // guard got there first — closes it on the next render instead of leaving a
  // choice about a row that is gone.
  const confirming = visits.find((visit) => visit.id === confirmingId) ?? null;

  // Guards against overlapping polls when a request outlives the interval.
  const inFlight = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Set the moment a 401 comes back. A ref rather than state because the poll
   * and the action handler both branch on it in the same tick they set it — a
   * state update would not have landed yet, and the interval would fire one
   * more doomed request.
   */
  const signedOut = useRef(false);

  /**
   * A 401 means the session is gone — it expired mid-shift, or it was revoked.
   * Every button on this page will fail from here, so say so plainly instead of
   * reporting it as a network fault and leaving the guard pressing buttons that
   * quietly do nothing.
   *
   * `router.refresh()` re-runs the dashboard layout, whose session check sends
   * them to /login. The server decides where they go; this only asks it again.
   */
  const handleSessionLoss = useCallback(() => {
    if (signedOut.current) return;
    signedOut.current = true;
    setPollError("Your session has ended — taking you back to sign in…");
    router.refresh();
  }, [router]);

  const refresh = useCallback(async () => {
    if (inFlight.current || signedOut.current) return;
    inFlight.current = true;

    try {
      const response = await fetch("/api/visits", { cache: "no-store" });

      if (response.status === 401) {
        handleSessionLoss();
        return;
      }

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = (await response.json()) as { visits: ActiveVisit[] };
      setVisits(data.visits);
      setPollError(null);
    } catch {
      setPollError("Live updates paused — retrying…");
    } finally {
      inFlight.current = false;
    }
  }, [handleSessionLoss]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Skip polling a backgrounded tab; it refreshes once visible again.
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  /**
   * Highlights a row that stayed in the list. A check-out removes its row, so
   * there is nothing left to flash — its toast carries the confirmation alone.
   */
  function flashRow(visitId: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);

    setFlashedId(visitId);
    flashTimer.current = setTimeout(() => setFlashedId(null), FLASH_MS);
  }

  /** Optimistic update so the row responds before the next poll lands. */
  function applyLocally(visitId: string, action: VisitAction) {
    if (action === "checkout") {
      setVisits((current) => current.filter((visit) => visit.id !== visitId));
      return;
    }

    setVisits((current) =>
      current.map((visit) =>
        visit.id !== visitId
          ? visit
          : action === "step-out"
            ? {
                ...visit,
                status: "PENDING_RETURN",
                exitTime: new Date().toISOString(),
              }
            : { ...visit, status: "ACTIVE", exitTime: null },
      ),
    );

    flashRow(visitId);
  }

  async function runAction(visitId: string, action: VisitAction) {
    // The buttons are disabled while pending, but guard here too so a stray
    // double-submit cannot fire a second request.
    if (pendingIds.includes(visitId)) return;

    // Read the name up front: a check-out drops the row before the toast fires.
    const target = visits.find((visit) => visit.id === visitId);
    const visitorName = target
      ? formatFullName(target.firstName, target.lastName)
      : "This visitor";

    setPendingIds((ids) => [...ids, visitId]);

    try {
      const response = await fetch(`/api/visits/${visitId}/${action}`, {
        method: "POST",
      });

      if (response.ok) {
        applyLocally(visitId, action);
        showToast(ACTION_DONE[action](visitorName));
      } else if (response.status === 401) {
        handleSessionLoss();
        return;
      } else if (response.status === 409 || response.status === 404) {
        // The row already moved on server-side — a double-click, or another
        // guard. Checking out means it is gone either way; the other two are
        // left to the refresh below, which has the authoritative state.
        if (action === "checkout") {
          setVisits((current) => current.filter((v) => v.id !== visitId));
        }

        showToast("Someone already updated this visit.", "error");
      } else {
        const data = await response.json().catch(() => null);
        showToast(data?.error ?? ACTION_ERROR[action], "error");
      }
    } catch {
      showToast(
        `Network problem — ${ACTION_ERROR[action].toLowerCase()}`,
        "error",
      );
    } finally {
      setPendingIds((ids) => ids.filter((id) => id !== visitId));
      // Reconcile with the server regardless of which branch we took.
      void refresh();
    }
  }

  function confirmCheckOut(visit: ActiveVisit) {
    // Someone already marked as returning has answered this question, so their
    // check-out is taken at face value rather than asked about again.
    if (visit.status === "PENDING_RETURN") {
      void runAction(visit.id, "checkout");
      return;
    }

    setConfirmingId(visit.id);
  }

  function toggleExpanded(visitId: string) {
    setExpandedId((current) => (current === visitId ? null : visitId));
  }

  /**
   * Clicking anywhere in a row opens its timeline, except on the controls that
   * own their own clicks — the row is a much bigger target than the chevron.
   */
  function onRowClick(event: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if ((event.target as HTMLElement).closest("button, a, input, select")) {
      return;
    }

    toggleExpanded(id);
  }

  function resolveDialog(action: Extract<VisitAction, "checkout" | "step-out">) {
    if (!confirming) return;

    const visitId = confirming.id;
    setConfirmingId(null);
    void runAction(visitId, action);
  }

  const onSite = visits.filter((visit) => visit.status === "ACTIVE").length;
  const returning = visits.length - onSite;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-white">
            {onSite}
          </span>{" "}
          {onSite === 1 ? "visitor" : "visitors"} on site
          {returning > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                {returning}
              </span>{" "}
              out, returning
            </>
          )}
        </p>

        {pollError ? (
          <span
            role="status"
            className="text-xs font-medium text-amber-600 dark:text-amber-400"
          >
            {pollError}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
            Live
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {/*
          `table-fixed` with widths on the headers, and no horizontal scroll
          container: name, status and check-in time stay readable at any width.
          Purpose and host are the ones that give way — they truncate behind a
          tooltip, and drop out entirely on narrow screens, where they reappear
          as a secondary line under the name instead.
        */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
              <th scope="col" className="w-[40%] px-4 py-3 sm:w-[34%] lg:w-[26%]">
                Visitor
              </th>
              <th
                scope="col"
                className="hidden px-4 py-3 md:table-cell md:w-[20%]"
              >
                Purpose
              </th>
              <th
                scope="col"
                className="hidden px-4 py-3 lg:table-cell lg:w-[18%]"
              >
                Host
              </th>
              <th scope="col" className="w-[26%] px-4 py-3 sm:w-[20%] md:w-[14%]">
                Checked In
              </th>
              <th
                scope="col"
                className="w-[34%] px-4 py-3 text-right sm:w-[26%] md:w-[22%]"
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {visits.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon="🪑"
                    title="Nobody is checked in right now"
                    hint="Visitors appear here the moment they check in at the kiosk."
                  />
                </td>
              </tr>
            ) : (
              visits.map((visit) => {
                const pending = pendingIds.includes(visit.id);
                const isReturning = visit.status === "PENDING_RETURN";
                const flashed = flashedId === visit.id;
                const expanded = expandedId === visit.id;
                // A visit with no purpose is possible — a delivery logged
                // while the "Delivery" option was missing, or a legacy row.
                const purposeLabel = visit.purposeLabel ?? "—";
                const hostLabel = visit.hostName
                  ? `${visit.hostName} · ${visit.hostDepartment}`
                  : "Reception";

                return (
                  <Fragment key={visit.id}>
                  <tr
                    onClick={(event) => onRowClick(event, visit.id)}
                    className={`cursor-pointer transition-colors duration-500 ${
                      flashed
                        ? "bg-green-50 dark:bg-green-500/10"
                        : isReturning
                          ? "bg-amber-50/40 hover:bg-gray-50 dark:bg-amber-500/5 dark:hover:bg-gray-700/40"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    }`}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-y-1">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(visit.id)}
                          aria-expanded={expanded}
                          aria-controls={`timeline-${visit.id}`}
                          title={formatFullName(visit.firstName, visit.lastName)}
                          className="flex min-w-0 max-w-full items-center gap-1 text-left font-medium text-gray-900 hover:underline dark:text-white"
                        >
                          <TimelineChevron open={expanded} />
                          <span className="truncate">{formatFullName(visit.firstName, visit.lastName)}</span>
                        </button>
                        <VisitorTypeBadge type={visit.visitorType} />
                        <VisitStatusBadge status={visit.status} />
                      </div>

                      {/* Stand-in for the two columns hidden at this width. */}
                      <div
                        className="mt-1 truncate text-xs text-gray-500 lg:hidden dark:text-gray-400"
                        title={`${purposeLabel} · ${hostLabel}`}
                      >
                        <span className="md:hidden">{purposeLabel} · </span>
                        {hostLabel}
                      </div>
                    </td>

                    <td
                      className="hidden truncate px-4 py-3 align-top text-gray-600 md:table-cell dark:text-gray-300"
                      title={purposeLabel}
                    >
                      {purposeLabel}
                    </td>

                    <td
                      className="hidden px-4 py-3 align-top lg:table-cell"
                      title={hostLabel}
                    >
                      {visit.hostName ? (
                        <>
                          <div className="truncate text-gray-900 dark:text-white">
                            {visit.hostName}
                          </div>
                          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {visit.hostDepartment}
                          </div>
                        </>
                      ) : (
                        // Only a legacy delivery row from the retired kiosk
                        // flow can still be sitting here without a host.
                        <span className="text-gray-400 dark:text-gray-500">
                          Reception
                        </span>
                      )}
                    </td>

                    <td
                      className="px-4 py-3 align-top tabular-nums text-gray-600 dark:text-gray-300"
                      // Server and browser can sit in different time zones.
                      suppressHydrationWarning
                    >
                      {formatTime(visit.checkInTime)}
                      {isReturning && visit.exitTime && (
                        <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Out since {formatTime(visit.exitTime)}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap justify-end gap-2">
                        {isReturning && (
                          <button
                            type="button"
                            onClick={() => runAction(visit.id, "return")}
                            disabled={pending}
                            className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                          >
                            {pending ? "Working…" : "Mark as returned"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => confirmCheckOut(visit)}
                          disabled={pending}
                          className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900"
                        >
                          {pending && !isReturning
                            ? "Checking out…"
                            : "Check out"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expanded && (
                    <tr className="bg-gray-50 dark:bg-gray-900/40">
                      <td
                        id={`timeline-${visit.id}`}
                        colSpan={5}
                        className="px-4 py-4 pl-9"
                      >
                        {/* Keyed on status so stepping someone out or marking
                            them back re-fetches instead of leaving the panel
                            showing the timeline from a moment ago. */}
                        <VisitTimeline
                          visitId={visit.id}
                          refreshKey={visit.status}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-today-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h2
                id="return-today-title"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                Will this visitor return later today?
              </h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {formatFullName(confirming.firstName, confirming.lastName)} is on their way out. Marking them as
                returning keeps this visit open, so they resume it when they get
                back instead of checking in again.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingId(null)}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveDialog("step-out")}
                className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                Yes, mark as returning
              </button>
              <button
                type="button"
                onClick={() => resolveDialog("checkout")}
                className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
              >
                No, check out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
