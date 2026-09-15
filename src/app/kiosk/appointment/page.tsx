import Link from "next/link";

import { AppointmentForm } from "./appointment-form";

export default function AppointmentPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <AppointmentForm />

        <div className="text-center">
          <Link
            href="/kiosk"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
