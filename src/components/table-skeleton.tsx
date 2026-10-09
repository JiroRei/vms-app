/**
 * Placeholder rows shown while a table's page is still loading.
 *
 * Reserves the same chrome and roughly the same height as the real table, so
 * the surrounding page does not shift when the data lands. The bars carry no
 * text and the whole block is hidden from assistive tech — the visible status
 * message belongs to the caller.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="h-11 border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50" />
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }, (_, column) => (
              <div
                key={column}
                className="h-3 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
                // Staggered so the row reads as a row of content rather than a
                // set of identical bars.
                style={{ animationDelay: `${(row * columns + column) * 40}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A pulsing bar standing in for a line of text. */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
    />
  );
}
