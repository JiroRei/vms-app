"use client";

import { useCallback, useEffect, useState } from "react";

import type { VisitEventType } from "@/generated/prisma/enums";
import type { VisitTimeline as VisitTimelineData } from "@/lib/visits";

const EVENT_LABEL: Record<VisitEventType, string> = {
  CHECK_IN: "Checked in",
  STEP_OUT: "Stepped out (returning)",
  RETURN: "Returned",
  CHECK_OUT: "Checked out",
};

/** Dot colors reuse the palette the badges already assign to each state. */
const EVENT_DOT: Record<VisitEventType, string> = {
  CHECK_IN: "bg-green-500",
  STEP_OUT: "bg-amber-500",
  RETURN: "bg-blue-500",
  CHECK_OUT: "bg-gray-400 dark:bg-gray-500",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** Local calendar day, used to decide whether an event needs its date shown. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * The affordance that opens a `VisitTimeline`, so the live list and history show
 * the same one. Rotates to point down while the timeline is open.
 */
export function TimelineChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500 ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0Z" />
    </svg>
  );
}

/**
 * One visit's event timeline, fetched when it is asked for.
 *
 * Shared by the live list and history so both read the same way, and so a
 * delivery needs no special case: it is checked in and out at one instant, which
 * comes back as an ordinary two-event timeline.
 *
 * `refreshKey` is for the live list, where a visit can change underneath an open
 * panel — passing the visit's status re-fetches the timeline when the guard
 * steps someone out or marks them back, instead of leaving stale entries on
 * screen. History has nothing to pass.
 */
export function VisitTimeline({
  visitId,
  refreshKey,
}: {
  visitId: string;
  refreshKey?: string;
}) {
  const [timeline, setTimeline] = useState<VisitTimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    // Collapsing and re-expanding quickly would otherwise let an older response
    // land after a newer one.
    const controller = new AbortController();

    async function load() {
      setError(null);

      try {
        const response = await fetch(`/api/visits/${visitId}/events`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        setTimeline((await response.json()) as VisitTimelineData);
      } catch {
        // An aborted fetch is a collapse, not a failure.
        if (controller.signal.aborted) return;
        setError("Could not load this visit's timeline.");
      }
    }

    void load();

    return () => controller.abort();
  }, [visitId, refreshKey, attempt]);

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <button
          type="button"
          onClick={retry}
          className="min-h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!timeline) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Loading timeline…
      </p>
    );
  }

  const { events, purposeLabel } = timeline;

  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No events recorded for this visit.
      </p>
    );
  }

  // Every event on the visit's opening day shows a time alone; one that spilled
  // into another day says so, rather than reading as an impossible ordering.
  const firstDay = dayKey(events[0].timestamp);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Visit timeline
        </h3>
        {/* The option's label, joined server-side — never a stored string. */}
        {purposeLabel && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            · {purposeLabel}
          </span>
        )}
      </div>

      <ol className="ml-1 space-y-3 border-l border-gray-200 dark:border-gray-600">
        {events.map((event) => (
          <li key={event.id} className="relative pl-5">
            <span
              aria-hidden
              className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 ${EVENT_DOT[event.eventType]}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                {dayKey(event.timestamp) === firstDay
                  ? formatTime(event.timestamp)
                  : `${formatDate(event.timestamp)}, ${formatTime(event.timestamp)}`}
              </span>
              <span aria-hidden className="text-gray-300 dark:text-gray-600">
                —
              </span>
              <span className="text-gray-600 dark:text-gray-300">
                {EVENT_LABEL[event.eventType]}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
