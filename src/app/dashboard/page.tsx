// TEMP: dev-only auth, replace with Better Auth call.
import { getDevSession } from "@/lib/dev-auth";
import { getActiveVisits } from "@/lib/visits";

import { CloseStaleVisits } from "./close-stale-visits";
import { LiveCheckIns } from "./live-check-ins";

export default async function DashboardPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const [visits, session] = await Promise.all([
    getActiveVisits(),
    getDevSession(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Live Check-ins
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Visitors currently checked in
          </p>
        </div>

        {/* Bulk-rewrites historical records, so admins only. The API enforces
            this too — hiding the button is not the control. */}
        {session?.role === "ADMIN" && <CloseStaleVisits />}
      </div>

      <LiveCheckIns initialVisits={visits} />
    </div>
  );
}
