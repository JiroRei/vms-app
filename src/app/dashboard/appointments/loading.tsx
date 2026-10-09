import { SkeletonLine, TableSkeleton } from "@/components/table-skeleton";

/**
 * Shown while the appointment list and host options are fetched.
 *
 * Mirrors the real page — heading, the create panel, then the table — so the
 * layout is already the right shape when the data lands.
 */
export default function AppointmentsLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Loading appointments…</span>

      <div className="space-y-2">
        <SkeletonLine className="h-7 w-48" />
        <SkeletonLine className="h-4 w-72" />
      </div>

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <SkeletonLine className="h-5 w-56" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
        </div>
        <SkeletonLine className="h-10 w-44" />
      </div>

      <TableSkeleton rows={4} columns={5} />
    </div>
  );
}
