import Link from "next/link";

import { getSession } from "@/lib/session";
import { getActiveVisits, getHosts } from "@/lib/visits";

import { CloseStaleVisits } from "./close-stale-visits";
import { LiveCheckIns } from "./live-check-ins";
import { LogDelivery } from "./log-delivery";

export default async function DashboardPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const [visits, hosts, session] = await Promise.all([
    getActiveVisits(),
    getHosts(),
    getSession(),
  ]);

  return (
    <div className="space-y-6">
      {/* Sticky, and pulled out to the edges of the page padding, so the two
          actions a guard reaches for most stay on screen however far down the
          list they have scrolled. */}
      <div className="sticky top-0 z-30 -mx-6 -mt-6 border-b border-gray-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Live Check-ins
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Visitors currently checked in
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Same weight as Log delivery — both are one-tap actions a guard
                reaches for with a visitor already standing in front of them. */}
            <Link
              href="/dashboard/scan"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              <span aria-hidden className="text-base">
                📷
              </span>
              Scan QR
            </Link>

            <LogDelivery hosts={hosts} />

            {/* Bulk-rewrites historical records, so admins only. The API
                enforces this too — hiding the button is not the control. */}
            {session?.role === "ADMIN" && <CloseStaleVisits />}
          </div>
        </div>
      </div>

      <LiveCheckIns initialVisits={visits} />
    </div>
  );
}
