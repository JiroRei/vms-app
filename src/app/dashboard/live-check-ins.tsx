"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { VisitStatusBadge } from "@/components/visit-status-badge";
import { VisitorTypeBadge } from "@/components/visitor-type-badge";
import { formatTime } from "@/lib/dates";
import type { ActiveVisit } from "@/lib/visits";

const POLL_INTERVAL_MS = 5000;

/** The three row actions, and the endpoint each one posts to. */
type VisitAction = "checkout" | "step-out" | "return";

const ACTION_ERROR: Record<VisitAction, string> = {
  checkout: "Could not check out this visitor.",
  "step-out": "Could not mark this visitor as returning.",
  return: "Could not mark this visitor as returned.",
};

const actionButtonClass =
  "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const returnButtonClass = `${actionButtonClass} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20`;
const checkOutButtonClass = `${actionButtonClass} border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700`;

export function LiveCheckIns({
  initialVisits,
}: {
  initialVisits: ActiveVisit[];
}) {
  const [visits, setVisits] = useState(initialVisits);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True only while a poll is actually in flight. */
  const [refreshing, setRefreshing] = useState(false);
  /** The visit whose "will they return?" dialog is open, if any. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Resolved from the current list rather than held as its own copy of the
  // visit, so a poll that checks the row out from under an open dialog — another
  // guard got there first — closes it on the next render instead of leaving a
  // choice about a row that is gone.
  const confirming = visits.find((visit) => visit.id === confirmingId) ?? null;

  // Guards against overlapping polls when a request outlives the interval.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);

    try {
      const response = await fetch("/api/visits", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = (await response.json()) as { visits: ActiveVisit[] };
      setVisits(data.visits);
      setError(null);
    } catch {
      setError("Live updates paused — retrying…");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

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
  }

  async function runAction(visitId: string, action: VisitAction) {
    // The buttons are disabled while pending, but guard here too so a stray
    // double-submit cannot fire a second request.
    if (pendingIds.includes(visitId)) return;

    setPendingIds((ids) => [...ids, visitId]);
    setError(null);

    try {
      const response = await fetch(`/api/visits/${visitId}/${action}`, {
        method: "POST",
      });

      if (response.ok) {
        applyLocally(visitId, action);
      } else if (response.status === 409 || response.status === 404) {
        // The row already moved on server-side — a double-click, or another
        // guard. Checking out means it is gone either way; the other two are
        // left to the refresh below, which has the authoritative state.
        if (action === "checkout") {
          setVisits((current) => current.filter((v) => v.id !== visitId));
        }
      } else {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? ACTION_ERROR[action]);
      }
    } catch {
      setError(`Network problem — ${ACTION_ERROR[action].toLowerCase()}`);
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

    setError(null);
    setConfirmingId(visit.id);
  }

  function resolveDialog(action: Extract<VisitAction, "checkout" | "step-out">) {
    if (!confirming) return;

    const visitId = confirming.id;
    setConfirmingId(null);
    void runAction(visitId, action);
  }

  const onSite = visits.filter((visit) => visit.status === "ACTIVE").length;
  const returning = visits.length - onSite;
  const isEmpty = visits.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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

        {/* The poll indicator lives up here on purpose: the rows are never
            blanked or replaced by a spinner, so the table cannot jump while a
            refresh is in flight. */}
        <RefreshIndicator error={error} refreshing={refreshing} />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {isEmpty ? (
          <EmptyState
            icon="🪑"
            title="Nobody is checked in right now"
            hint="Visitors appear here the moment they check in at the kiosk."
          />
        ) : (
          <>
            {/* Phone: stacked cards. A five-column table would put the action
                buttons off the right edge, and checking someone out from a
                phone is exactly what a roving guard needs to do. */}
            <ul className="divide-y divide-gray-100 md:hidden dark:divide-gray-700">
              {visits.map((visit) => (
                <VisitCard
                  key={visit.id}
                  visit={visit}
                  pending={pendingIds.includes(visit.id)}
                  onCheckOut={() => confirmCheckOut(visit)}
                  onReturn={() => runAction(visit.id, "return")}
                />
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
                    <th scope="col" className="px-4 py-3">
                      Visitor
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Purpose
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Host
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Checked In
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visits.map((visit) => {
                    const pending = pendingIds.includes(visit.id);
                    const isReturning = visit.status === "PENDING_RETURN";

                    return (
                      <tr
                        key={visit.id}
                        className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 ${
                          isReturning ? "bg-amber-50/40 dark:bg-amber-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          {visit.visitorName}
                          <VisitorTypeBadge type={visit.visitorType} />
                          <VisitStatusBadge status={visit.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {visit.purpose}
                        </td>
                        <td className="px-4 py-3">
                          <HostCell visit={visit} />
                        </td>
                        <td
                          className="px-4 py-3 tabular-nums text-gray-600 dark:text-gray-300"
                          // Server and browser can sit in different time zones.
                          suppressHydrationWarning
                        >
                          {formatTime(visit.checkInTime)}
                          {isReturning && visit.exitTime && (
                            <div
                              className="text-xs font-medium text-amber-700 dark:text-amber-400"
                              suppressHydrationWarning
                            >
                              Out since {formatTime(visit.exitTime)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <RowActions
                              visit={visit}
                              pending={pending}
                              onCheckOut={() => confirmCheckOut(visit)}
                              onReturn={() => runAction(visit.id, "return")}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
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
                {confirming.visitorName} is on their way out. Marking them as
                returning keeps this visit open, so they resume it when they get
                back instead of checking in again.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingId(null)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveDialog("step-out")}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                Yes, mark as returning
              </button>
              <button
                type="button"
                onClick={() => resolveDialog("checkout")}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
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

/** Polling state, in one corner: an error, a refresh in flight, or "Live". */
function RefreshIndicator({
  error,
  refreshing,
}: {
  error: string | null;
  refreshing: boolean;
}) {
  if (error) {
    return (
      <span
        role="status"
        className="text-xs font-medium text-amber-600 dark:text-amber-400"
      >
        {error}
      </span>
    );
  }

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-green-500 ${
          refreshing ? "animate-pulse" : ""
        }`}
        aria-hidden
      />
      {refreshing ? "Updating…" : "Live"}
    </span>
  );
}

/** A host and their department, or the fallback for an unaddressed delivery. */
function HostCell({ visit }: { visit: ActiveVisit }) {
  if (!visit.hostName) {
    // A delivery can arrive without a named recipient.
    return (
      <span className="text-gray-400 dark:text-gray-500">Reception</span>
    );
  }

  return (
    <>
      <div className="text-gray-900 dark:text-white">{visit.hostName}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {visit.hostDepartment}
      </div>
    </>
  );
}

function RowActions({
  visit,
  pending,
  onCheckOut,
  onReturn,
}: {
  visit: ActiveVisit;
  pending: boolean;
  onCheckOut: () => void;
  onReturn: () => void;
}) {
  const isReturning = visit.status === "PENDING_RETURN";

  return (
    <>
      {isReturning && (
        <button
          type="button"
          onClick={onReturn}
          disabled={pending}
          className={returnButtonClass}
        >
          {pending ? "Working…" : "Mark as returned"}
        </button>
      )}

      <button
        type="button"
        onClick={onCheckOut}
        disabled={pending}
        className={checkOutButtonClass}
      >
        {pending && !isReturning ? "Checking out…" : "Check out"}
      </button>
    </>
  );
}

/** The phone rendering of a row. */
function VisitCard({
  visit,
  pending,
  onCheckOut,
  onReturn,
}: {
  visit: ActiveVisit;
  pending: boolean;
  onCheckOut: () => void;
  onReturn: () => void;
}) {
  const isReturning = visit.status === "PENDING_RETURN";

  return (
    <li
      className={`space-y-3 p-4 ${
        isReturning ? "bg-amber-50/40 dark:bg-amber-500/5" : ""
      }`}
    >
      <div>
        <p className="font-medium text-gray-900 dark:text-white">
          {visit.visitorName}
          <VisitorTypeBadge type={visit.visitorType} />
          <VisitStatusBadge status={visit.status} />
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {visit.purpose}
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Host
          </dt>
          <dd className="text-gray-900 dark:text-white">
            {visit.hostName ?? "Reception"}
            {visit.hostDepartment && (
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {visit.hostDepartment}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Checked in
          </dt>
          <dd
            className="tabular-nums text-gray-900 dark:text-white"
            // Server and browser can sit in different time zones.
            suppressHydrationWarning
          >
            {formatTime(visit.checkInTime)}
            {isReturning && visit.exitTime && (
              <span
                className="block text-xs font-medium text-amber-700 dark:text-amber-400"
                suppressHydrationWarning
              >
                Out since {formatTime(visit.exitTime)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <RowActions
          visit={visit}
          pending={pending}
          onCheckOut={onCheckOut}
          onReturn={onReturn}
        />
      </div>
    </li>
  );
}
