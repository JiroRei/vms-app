import { SkeletonLine, TableSkeleton } from "@/components/table-skeleton";

/**
 * Shown while the history query, host list and frequency chart resolve.
 *
 * Reserves the chart's height as well as the table's — it is the tallest block
 * on the page, and leaving it out is what would make everything below it jump.
 */
export default function HistoryLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Loading visit history…</span>

      <div className="space-y-2">
        <SkeletonLine className="h-7 w-44" />
        <SkeletonLine className="h-4 w-56" />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <SkeletonLine className="mb-4 h-4 w-40" />
        <SkeletonLine className="h-64 w-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonLine className="h-10" />
        <SkeletonLine className="h-10" />
        <SkeletonLine className="h-10" />
        <SkeletonLine className="h-10" />
      </div>

      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
