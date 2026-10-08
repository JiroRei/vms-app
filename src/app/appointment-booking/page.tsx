import Link from "next/link";

import { getActivePurposeOptions } from "@/lib/purposes";
import { getHosts } from "@/lib/visits";

import { BookingForm } from "./booking-form";

// Hosts and purposes are read per request so an admin's edit shows up here
// without a rebuild.
//
// Nothing time-dependent is computed here or in the form's first render: the
// date picker works out "now" after mount (see `useCurrentMinute`), so the
// server render and hydration can never disagree about it.
export const dynamic = "force-dynamic";

export default async function BookPage() {
  const [hosts, purposes] = await Promise.all([
    getHosts(),
    getActivePurposeOptions(),
  ]);

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <BookingForm hosts={hosts} purposes={purposes} />
        </div>

        <div className="flex justify-center gap-6 text-sm">
          <Link href="/" className="text-gray-600 hover:text-gray-900">
            Back to home
          </Link>
          <Link href="/privacy" className="text-gray-600 hover:text-gray-900">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
