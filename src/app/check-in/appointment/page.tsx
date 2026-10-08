import Link from "next/link";

import { AppointmentCheckIn } from "@/components/appointment-check-in";

export default function AppointmentPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <AppointmentCheckIn mode="kiosk" />

        <div className="space-y-2 text-center">
          {/* A visitor whose code will not work at all still has a way in. */}
          <Link
            href="/check-in/walkin"
            className="block text-sm font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900"
          >
            Register as a walk-in instead
          </Link>
          <Link
            href="/check-in"
            className="block text-sm text-gray-500 hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
