import { RECURRING_VISITS_THRESHOLD, RECURRING_WINDOW_DAYS } from "@/lib/booking-config";
import { listProfilesForStaff, STAFF_PROFILE_LIMIT } from "@/lib/visitor-pass";

import { VisitorDirectory } from "./visitor-directory";

// Pass states depend on the clock (expiry), so never serve a cached render.
export const dynamic = "force-dynamic";

/**
 * /dashboard/visitors — returning-visitor profiles and their passes.
 *
 * The session guard lives in `src/app/dashboard/layout.tsx`. Search is a plain
 * `?q=` so it survives a refresh and a shared link.
 */
export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const profiles = await listProfilesForStaff(q);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Visitors</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Returning-visitor profiles. A profile is issued a visitor pass
          automatically after {RECURRING_VISITS_THRESHOLD} visits within{" "}
          {RECURRING_WINDOW_DAYS} days.
        </p>
      </div>

      <VisitorDirectory profiles={profiles} query={q} limit={STAFF_PROFILE_LIMIT} />
    </div>
  );
}
