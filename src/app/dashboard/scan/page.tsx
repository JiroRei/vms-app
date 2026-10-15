import Link from "next/link";

import { AppointmentCheckIn } from "@/components/appointment-check-in";
import { requireStaff } from "@/lib/session";

export default async function ScanPage() {
  // The check-in call re-checks the session server-side, because that is what
  // stamps the guard onto the visit.
  await requireStaff();
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
