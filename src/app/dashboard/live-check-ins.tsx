"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { VisitorTypeBadge } from "@/components/visitor-type-badge";
import type { ActiveVisit } from "@/lib/visits";

const POLL_INTERVAL_MS = 5000;

function formatCheckInTime(iso: string): string {
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
  const [visits, setVisits] = useState(initialVisits);
  const [checkingOutIds, setCheckingOutIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Guards against overlapping polls when a request outlives the interval.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

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

  async function handleCheckOut(visitId: string) {
    // The button is disabled while pending, but guard here too so a stray
    // double-submit cannot fire a second request.
    if (checkingOutIds.includes(visitId)) return;

    setCheckingOutIds((ids) => [...ids, visitId]);
    setError(null);

    try {
      const response = await fetch(`/api/visits/${visitId}/checkout`, {
        method: "POST",
      });

      if (response.ok || response.status === 409 || response.status === 404) {
        // 409/404 mean the row is already gone server-side — drop it either way.
        setVisits((current) => current.filter((visit) => visit.id !== visitId));
      } else {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Could not check out this visitor.");
      }
    } catch {
      setError("Network problem — could not check out this visitor.");
    } finally {
      setCheckingOutIds((ids) => ids.filter((id) => id !== visitId));
      // Reconcile with the server regardless of which branch we took.
      void refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-white">
            {visits.length}
          </span>{" "}
          {visits.length === 1 ? "visitor" : "visitors"} on site
        </p>

        {error ? (
          <span
            role="status"
            className="text-xs font-medium text-amber-600 dark:text-amber-400"
          >
            {error}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
            <span
              className="h-1.5 w-1.5 rounded-full bg-green-500"
              aria-hidden
            />
            Live
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="overflow-x-auto">
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
              {visits.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                    colSpan={5}
                  >
                    No active check-ins
                  </td>
                </tr>
              ) : (
                visits.map((visit) => {
                  const pending = checkingOutIds.includes(visit.id);

                  return (
                    <tr
                      key={visit.id}
                      className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {visit.visitorName}
                        <VisitorTypeBadge type={visit.visitorType} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {visit.purpose}
                      </td>
                      <td className="px-4 py-3">
                        {visit.hostName ? (
                          <>
                            <div className="text-gray-900 dark:text-white">
                              {visit.hostName}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {visit.hostDepartment}
                            </div>
                          </>
                        ) : (
                          // A delivery can arrive without a named recipient.
                          <span className="text-gray-400 dark:text-gray-500">
                            Reception
                          </span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 tabular-nums text-gray-600 dark:text-gray-300"
                        // Server and browser can sit in different time zones.
                        suppressHydrationWarning
                      >
                        {formatCheckInTime(visit.checkInTime)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleCheckOut(visit.id)}
                          disabled={pending}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          {pending ? "Checking out…" : "Check out"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
