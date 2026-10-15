/**
 * The dashboard summary counts, shared between the server query and the client
 * cards that poll it.
 *
 * Kept apart from `dashboard-stats.ts` because that module is `server-only`,
 * and a client component may still import the shape of what it renders.
 */
export type DashboardStats = {
  /** Visitors on site right now — open visits that are not deliveries. */
  onSite: number;
  /** Visitors who stepped out and are due back today. */
  outReturning: number;
  /** Guest visits checked in today, whatever their current status. */
  visitorsToday: number;
  /** Delivery visits checked in today. */
  deliveriesToday: number;
  /** Appointments still expected to arrive today. */
  appointmentsStillExpected: number;
  /** Every non-cancelled appointment booked for today. */
  appointmentsBookedToday: number;
};
