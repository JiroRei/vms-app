import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { VisitorTypeBadge } from "@/components/visitor-type-badge";
import { formatDateTime, formatDuration } from "@/lib/dates";
import {
  getVisitHistory,
  getVisitorFrequency,
  PAGE_SIZE,
  type HistoryFilters as Filters,
  type HistoryVisit,
} from "@/lib/history";
// The full directory rather than `getHosts()`: a visit from last year still
// belongs to whoever hosted it, so a host who has since left has to stay
// filterable here even though the kiosk no longer offers them.
import { listHosts } from "@/lib/hosts";

import { HistoryFilters } from "./history-filters";
import { VisitorFrequencyChart } from "./visitor-frequency-chart";

/** Reads `?page=` etc. — a bad value falls back rather than throwing. */
function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

/** Whether the visitor is looking at a filtered view or the whole log. */
function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.search ||
      filters.hostId ||
      filters.from ||
      filters.to ||
      filters.hideDeliveries,
  );
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
 */
function StatusCell({ visit }: { visit: HistoryVisit }) {
  if (visit.checkOutTime) {
    return (
      <div suppressHydrationWarning>
        <span className="tabular-nums text-gray-600 dark:text-gray-300">
          {formatDateTime(visit.checkOutTime)}
        </span>
        {/* Both ends of the stay are recorded, so this is fixed history — no
            clock needed, and it renders identically on server and client. */}
        <span className="block text-xs text-gray-400 dark:text-gray-500">
          {formatDuration(visit.checkInTime, visit.checkOutTime)} on site
        </span>
        {/* No name means the overnight cleanup closed it rather than a person
            at the desk — a different kind of record, so it says so. */}
        <span className="block text-xs text-gray-400 dark:text-gray-500">
          {visit.checkedOutByName
            ? `by ${visit.checkedOutByName}`
            : "closed automatically"}
        </span>
      </div>
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

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const params = await searchParams;

  const filters: Filters = {
    search: readParam(params, "search"),
    hostId: readParam(params, "hostId"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
    hideDeliveries: readParam(params, "hideDeliveries") === "1",
    page: Number.parseInt(readParam(params, "page"), 10) || 1,
  };

  const [history, hosts, frequency] = await Promise.all([
    getVisitHistory(filters),
    listHosts(),
    // Always 30 days; the chart's week view slices client-side.
    getVisitorFrequency(30),
  ]);

  /** Builds a page link that preserves the active filters. */
  function pageHref(page: number): string {
    const query = new URLSearchParams();

    if (filters.search) query.set("search", filters.search);
    if (filters.hostId) query.set("hostId", filters.hostId);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.hideDeliveries) query.set("hideDeliveries", "1");
    if (page > 1) query.set("page", String(page));

    const qs = query.toString();
    return qs ? `/dashboard/history?${qs}` : "/dashboard/history";
  }

  const filtered = hasActiveFilters(filters);
  const firstRow = history.total === 0 ? 0 : (history.page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(history.page * PAGE_SIZE, history.total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Visit History
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Past visitor records
        </p>
      </div>

      <VisitorFrequencyChart data={frequency} />

      <HistoryFilters
        // Remounts with fresh state whenever the active filters change.
        key={`${filters.search}|${filters.hostId}|${filters.from}|${filters.to}|${filters.hideDeliveries}`}
        hosts={hosts}
        initial={{
          search: filters.search,
          hostId: filters.hostId,
          from: filters.from,
          to: filters.to,
          hideDeliveries: filters.hideDeliveries,
        }}
      />

      <div className="space-y-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {history.total === 0
            ? "No matching visits"
            : `Showing ${firstRow}–${lastRow} of ${history.total}`}
        </p>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {history.visits.length === 0 ? (
            // An empty log and an over-narrow filter look identical in a blank
            // table but need different next steps, so they are worded apart.
            filtered ? (
              <EmptyState
                icon="🔍"
                title="No visits match these filters"
                hint="Try widening the date range, or clearing the host and name filters."
                action={
                  <Link
                    href="/dashboard/history"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Clear all filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon="📖"
                title="No visit history yet"
                hint="Completed visits are logged here once visitors start checking in."
              />
            )
          ) : (
            <div className="overflow-x-auto">
              {/* The min-width makes a narrow screen scroll the table rather
                  than crushing five columns into unreadable slivers. */}
              <table className="w-full min-w-[48rem] text-sm">
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
                  {history.visits.map((visit) => (
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
                        suppressHydrationWarning
                      >
                        {formatDateTime(visit.checkInTime)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusCell visit={visit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {history.pageCount > 1 && (
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between gap-4"
          >
            <PageLink
              href={pageHref(history.page - 1)}
              disabled={history.page <= 1}
            >
              ← Previous
            </PageLink>

            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {history.page} of {history.pageCount}
            </span>

            <PageLink
              href={pageHref(history.page + 1)}
              disabled={history.page >= history.pageCount}
            >
              Next →
            </PageLink>
          </nav>
        )}
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  // `py-2` over the old `py-1.5`: these are the one control on the page a guard
  // taps repeatedly on a phone.
  const className =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium shadow-sm dark:border-gray-600";

  if (disabled) {
    return (
      <span
        aria-disabled
        className={`${className} cursor-not-allowed bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-600`}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${className} bg-white text-gray-700 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700`}
    >
      {children}
    </Link>
  );
}
