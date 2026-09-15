import "server-only";

import { endOfLocalDay, startOfLocalDay, toLocalDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export type StaleVisitSummary = {
  /** How many visits were closed by this run. */
  closed: number;
};

/**
 * Closes visits left open from a previous day.
 *
 * "Stale" means `checkOutTime IS NULL` and the visitor checked in before today
 * started — someone who walked out without checking out. Each visit is stamped
 * with end-of-day on the date it began, so a Monday visit does not read as a
 * three-day stay just because nobody ran the cleanup until Thursday.
 *
 * Deliberately standalone and parameterless: a button calls it today and a
 * scheduled job can call the same function later with no change. Nothing here
 * reads a request, a session or a cookie.
 */
export async function closeStaleVisits(): Promise<StaleVisitSummary> {
  const todayStart = startOfLocalDay();

  const stale = await prisma.visit.findMany({
    where: { checkOutTime: null, checkInTime: { lt: todayStart } },
    select: { id: true, checkInTime: true },
  });

  if (stale.length === 0) {
    return { closed: 0 };
  }

  // Visits sharing a check-in date share an end-of-day stamp, so they can be
  // closed one UPDATE per distinct date rather than one per row.
  const byDate = new Map<string, { endOfDay: Date; ids: string[] }>();

  for (const visit of stale) {
    const key = toLocalDateKey(visit.checkInTime);
    const group = byDate.get(key);

    if (group) {
      group.ids.push(visit.id);
    } else {
      byDate.set(key, {
        endOfDay: endOfLocalDay(visit.checkInTime),
        ids: [visit.id],
      });
    }
  }

  const closed = await prisma.$transaction(async (tx) => {
    let total = 0;

    for (const { endOfDay, ids } of byDate.values()) {
      // The `checkOutTime: null` guard is re-applied here so a guard checking
      // someone out mid-run keeps their real timestamp.
      const { count } = await tx.visit.updateMany({
        where: { id: { in: ids }, checkOutTime: null },
        data: { checkOutTime: endOfDay },
      });

      total += count;
    }

    return total;
  });

  return { closed };
}

/** How many visits `closeStaleVisits()` would close, without changing anything. */
export async function countStaleVisits(): Promise<number> {
  return prisma.visit.count({
    where: { checkOutTime: null, checkInTime: { lt: startOfLocalDay() } },
  });
}
