import { listAppointments } from "@/lib/appointments";
import { getHosts } from "@/lib/visits";

import { AppointmentManager } from "./appointment-manager";

export default async function AppointmentsPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`, which redirects
  // to /login before this renders.
  //
  // Redeemed appointments are fetched too, rather than filtered away in the
  // query: a single site has few enough of these that the whole list is
  // cheaper than a round trip every time someone ticks "show checked in".
  const [appointments, hosts] = await Promise.all([
    listAppointments({ includeUsed: true }),
    getHosts(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Appointments
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pre-registered visitors and their reference numbers
        </p>
      </div>

      <AppointmentManager appointments={appointments} hosts={hosts} />
    </div>
  );
}
