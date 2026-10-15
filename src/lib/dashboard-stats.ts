import "server-only";

import {
  addDaysToKey,
  dateKeyInZone,
  zonedTimeToUtc,
} from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { closeStaleVisits } from "@/lib/stale-visits";
import type { DashboardStats } from "@/lib/dashboard-stats-types";

/**
 * The five numbers across the top of the guard dashboard.
 *
 * One query per card, in parallel. Every "today" is a calendar day on the
 * building's clock, so a visitor who arrives at 00:10 counts as today and one
 * who arrived at 23:50 yesterday does not — even though a server in UTC would
 * put them the same side of midnight.
 *
 * Stale visits are closed first, exactly as the roll-call does, so a visit that
 * should already have auto-closed is never counted as on site.
 *
 * `now` is a parameter only so the day boundary can be tested; every caller
 * passes nothing.
 */
export async function getDashboardStats(
  now: Date = new Date(),
): Promise<DashboardStats> {
  await closeStaleVisits(now);

  const todayKey = dateKeyInZone(now);
  const todayStart = zonedTimeToUtc(todayKey, "00:00");
  const tomorrowStart = zonedTimeToUtc(addDaysToKey(todayKey, 1), "00:00");

  const [
    onSite,
    outReturning,
    visitorsToday,
    deliveriesToday,
    appointmentsStillExpected,
    appointmentsBookedToday,
  ] = await Promise.all([
    // Deliveries are logged, not hosted, so they never appear on the roll-call
    // and are not "on site" in the sense the guard means.
    prisma.visit.count({
      where: {
        status: "ACTIVE",
        closedAutomatically: false,
        visitor: { type: { not: "DELIVERY" } },
      },
    }),
    prisma.visit.count({
      where: {
        status: "PENDING_RETURN",
        closedAutomatically: false,
        visitor: { type: { not: "DELIVERY" } },
      },
    }),
    prisma.visit.count({
      where: {
        visitor: { type: "GUEST" },
        checkInTime: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.visit.count({
      where: {
        visitor: { type: "DELIVERY" },
        checkInTime: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.appointment.count({
      where: { status: "PENDING", scheduledFor: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.appointment.count({
      where: {
        status: { not: "CANCELLED" },
        scheduledFor: { gte: todayStart, lt: tomorrowStart },
      },
    }),
  ]);

  return {
    onSite,
    outReturning,
    visitorsToday,
    deliveriesToday,
    appointmentsStillExpected,
    appointmentsBookedToday,
  };
}
