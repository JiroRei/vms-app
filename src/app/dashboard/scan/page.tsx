import Link from "next/link";

import { AppointmentCheckIn } from "@/components/appointment-check-in";

export default function ScanPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders. The check-in call re-checks it server-side,
  // because that is what stamps the guard onto the visit.
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <AppointmentCheckIn mode="guard" />

      <div className="text-center">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Back to live check-ins
        </Link>
      </div>
    </div>
  );
}
