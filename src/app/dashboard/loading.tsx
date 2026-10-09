import { SkeletonLine, TableSkeleton } from "@/components/table-skeleton";

/**
 * Shown while the live check-in list is fetched on the server.
 *
 * Mirrors the real page's heading + table so the layout is already the right
 * shape when the data arrives and nothing shifts underneath the pointer.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Loading live check-ins…</span>

      <div className="space-y-2">
        <SkeletonLine className="h-7 w-48" />
        <SkeletonLine className="h-4 w-64" />
      </div>

      <TableSkeleton rows={5} columns={5} />
    </div>
  );
}
