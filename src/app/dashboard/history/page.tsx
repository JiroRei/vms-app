import Link from "next/link";

import { getVisitHistory, getVisitorFrequency, PAGE_SIZE } from "@/lib/history";
import { getHosts } from "@/lib/visits";

import { HistoryFilters } from "./history-filters";
import { HistoryTable } from "./history-table";
import { VisitorFrequencyChart } from "./visitor-frequency-chart";

/** Reads `?page=` etc. — a bad value falls back rather than throwing. */
function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const params = await searchParams;

  const filters = {
    search: readParam(params, "search"),
    hostId: readParam(params, "hostId"),
    from: readParam(params, "from"),
    to: readParam(params, "to"),
    hideDeliveries: readParam(params, "hideDeliveries") === "1",
    page: Number.parseInt(readParam(params, "page"), 10) || 1,
  };

  const [history, hosts, frequency] = await Promise.all([
    getVisitHistory(filters),
    getHosts(),
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

        <HistoryTable visits={history.visits} />

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
  const className =
    "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium shadow-sm dark:border-gray-600";

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
