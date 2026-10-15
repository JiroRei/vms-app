import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import {
  getHistoryQuery,
  historyFilterParams,
  PAGE_SIZE,
  type HistoryFilters as Filters,
} from "@/lib/history";
import { requireStaff } from "@/lib/session";
import { loadHostDirectory, loadVisitHistory, loadVisitorFrequency } from "@/lib/staff-data";

import { HistoryFilters } from "./history-filters";
import { HistoryTable } from "./history-table";
import { VisitorFrequencyChart } from "./visitor-frequency-chart";

/** Whether the visitor is looking at a filtered view or the whole log. */
function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.search ||
      filters.hostId ||
      filters.from ||
      filters.to ||
      filters.hideDeliveries || filters.type,
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaff();
  const params = await searchParams;

  const query = getHistoryQuery(params);
  const { filters } = query;

  const [history, hosts, frequency] = await Promise.all([
    loadVisitHistory(query),
    // The full directory rather than `getHosts()`: a visit from last year
    // still belongs to whoever hosted it, so a host who has since left has to
    // stay filterable here even though the kiosk no longer offers them.
    loadHostDirectory(),
    // Always 30 days; the chart's week view slices client-side.
    loadVisitorFrequency(30),
  ]);

  /** Builds a page link that preserves the active filters. */
  function pageHref(page: number): string {
    const query = historyFilterParams(filters);
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
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/dashboard/register" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
            Print today’s register
          </Link>
          {session?.role === "ADMIN" && (
            <a href={`/api/visits/export?${historyFilterParams(filters)}`} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800">
              Export CSV
            </a>
          )}
        </div>
      </div>

      <VisitorFrequencyChart data={frequency} />

      <HistoryFilters
        // Remounts with fresh state whenever the active filters change.
        key={`${filters.search}|${filters.hostId}|${filters.from}|${filters.to}|${filters.type}|${filters.hideDeliveries}`}
        hosts={hosts}
        initial={{
          search: filters.search,
          hostId: filters.hostId,
          from: filters.from,
          to: filters.to,
          hideDeliveries: filters.hideDeliveries,
          type: filters.type,
        }}
      />

      <div className="space-y-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {history.total === 0
            ? "No matching visits"
            : `Showing ${firstRow}–${lastRow} of ${history.total}`}
        </p>

        {history.visits.length === 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {/* An empty log and an over-narrow filter look identical in a blank
               table but need different next steps, so they are worded apart. */}
            {filtered ? (
              <EmptyState
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
                title="No visit history yet"
                hint="Completed visits are logged here once visitors start checking in."
              />
            )}
            </div>
        ) : (
          <HistoryTable visits={history.visits} />
        )}

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
