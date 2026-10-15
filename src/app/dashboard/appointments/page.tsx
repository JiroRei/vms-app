import { listStaffAppointments } from "@/lib/appointments";
import { getActivePurposeOptions } from "@/lib/purposes";
import { getHosts } from "@/lib/visits";

import { AppointmentBoard } from "./appointment-board";
import { AppointmentManager } from "./appointment-manager";

// The lists depend on the clock ("today"), so never serve a cached render.
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  const [lists, hosts, purposes] = await Promise.all([
    listStaffAppointments(),
    getHosts(),
    getActivePurposeOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Expected arrivals
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pre-registered visitors. Check someone in here if they arrive without
          their QR code.
        </p>
      </div>

      <AppointmentBoard lists={lists} />

      <AppointmentManager hosts={hosts} purposes={purposes} />
    </div>
  );
}
