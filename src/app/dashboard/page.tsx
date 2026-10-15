import Link from "next/link";

import { dateKeyInZone } from "@/lib/booking-config";
import { getSession } from "@/lib/session";
import { getActiveVisits, getHosts } from "@/lib/visits";

import { CloseStaleVisits } from "./close-stale-visits";
import { LiveCheckIns } from "./live-check-ins";
import { LogDelivery } from "./log-delivery";
import { StatCards } from "./stat-cards";

export default async function DashboardPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const [visits, hosts, session] = await Promise.all([
    getActiveVisits(),
    getHosts(),
    getSession(),
  ]);

  // The building's calendar day, so the "today" links land on the same day the
  // stats endpoint counts.
  const todayKey = dateKeyInZone(new Date());

  return (
    <div className="space-y-6">
      {/* Sticky, and pulled out to the edges of the page padding, so the two
          actions a guard reaches for most stay on screen however far down the
          list they have scrolled. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-gray-200 bg-gray-50/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8 dark:border-gray-800 dark:bg-gray-950/95">
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
          <Link href="/dashboard/register" className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
              Print today’s register
            </Link>
            {/* Same weight as Log delivery — both are one-tap actions a guard
                reaches for with a visitor already standing in front of them. */}
            <Link
              href="/dashboard/scan"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
            >
              Scan QR
            </Link>

            <LogDelivery hosts={hosts} />

            {/* Bulk-rewrites historical records, so admins only. The API
                enforces this too — hiding the button is not the control. */}
            {session?.role === "ADMIN" && <CloseStaleVisits />}
          </div>
        </div>
      </div>

      <StatCards todayKey={todayKey} />

      <LiveCheckIns initialVisits={visits} />
    </div>
  );
}
