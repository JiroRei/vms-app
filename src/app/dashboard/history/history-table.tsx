"use client";

import { Fragment, useState } from "react";

import { TimelineChevron, VisitTimeline } from "@/components/visit-timeline";
import { VisitorTypeBadge } from "@/components/visitor-type-badge";
import type { HistoryVisit } from "@/lib/history";
import { formatFullName } from "@/lib/names";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The check-out column: a timestamp for a finished visit, a badge for one that
 * is still open.
 *
 * Driven by `status` rather than by `checkOutTime` being null, because two
 * different open states now share a null check-out — someone still inside, and
 * someone who stepped out and is expected back. A visit that passed through
 * PENDING_RETURN and came back reads here as an ordinary completed visit: it is
 * the same row, so it carries its original check-in and its final check-out.
 * Expanding it is what shows the round trip it made on the way.
 */
function StatusCell({ visit }: { visit: HistoryVisit }) {
  if (visit.checkOutTime) {
    return (
      <span
        className="tabular-nums text-gray-600 dark:text-gray-300"
        suppressHydrationWarning
      >
        {formatDateTime(visit.checkOutTime)}
      </span>
    );
  }

  if (visit.status === "PENDING_RETURN") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        Out — Returning
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
      Still inside
    </span>
  );
}

/**
 * The host column, which a delivery fills in one of three ways: a host the
 * guard picked, a department they typed instead, or neither — a parcel simply
 * left at the desk.
 */
function RecipientCell({ visit }: { visit: HistoryVisit }) {
  if (visit.hostName) {
    return (
      <>
        <div className="text-gray-900 dark:text-white">{visit.hostName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {visit.hostDepartment}
        </div>
      </>
    );
  }

  if (visit.recipientDepartment) {
    return (
      <span className="text-gray-900 dark:text-white">
        {visit.recipientDepartment}
      </span>
    );
  }

  return <span className="text-gray-400 dark:text-gray-500">Reception</span>;
}

/**
 * The history table, split out of the page so its rows can expand.
 *
 * The page stays a server component and still does all the querying — this only
 * owns which row is open. The timeline behind that row is fetched by
 * `VisitTimeline` when it opens, so a page of 25 rows is still one query.
 */
export function HistoryTable({ visits }: { visits: HistoryVisit[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpanded(visitId: string) {
    setExpandedId((current) => (current === visitId ? null : visitId));
  }

  return (
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
                Check-in
              </th>
              <th scope="col" className="px-4 py-3">
                Check-out
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
                  No visit history yet
                </td>
              </tr>
            ) : (
              visits.map((visit) => {
                const expanded = expandedId === visit.id;

                return (
                  <Fragment key={visit.id}>
                    <tr
                      onClick={() => toggleExpanded(visit.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      <td className="px-4 py-3 align-top font-medium text-gray-900 dark:text-white">
                        <button
                          type="button"
                          onClick={(event) => {
                            // The row handles it; this only stops the click
                            // being counted twice and toggling back shut.
                            event.stopPropagation();
                            toggleExpanded(visit.id);
                          }}
                          aria-expanded={expanded}
                          aria-controls={`history-timeline-${visit.id}`}
                          className="flex items-center gap-1 text-left font-medium hover:underline"
                        >
                          <TimelineChevron open={expanded} />
                          {formatFullName(visit.firstName, visit.lastName)}
                        </button>
                        <VisitorTypeBadge type={visit.visitorType} />
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600 dark:text-gray-300">
                        {visit.purposeLabel ?? "—"}
                        {visit.note && (
                          <div className="text-xs italic text-gray-500 dark:text-gray-400">
                            {visit.note}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <RecipientCell visit={visit} />
                      </td>
                      <td
                        className="px-4 py-3 align-top tabular-nums text-gray-600 dark:text-gray-300"
                        suppressHydrationWarning
                      >
                        {formatDateTime(visit.checkInTime)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusCell visit={visit} />
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-gray-50 dark:bg-gray-900/40">
                        <td
                          id={`history-timeline-${visit.id}`}
                          colSpan={5}
                          className="px-4 py-4 pl-9"
                        >
                          <VisitTimeline visitId={visit.id} />
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
    </div>
  );
}
