import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export type StaleVisitSummary = {
  /** How many visits were closed by this run. */
  closed: number;
};

/**
 * Which visits count as stale, shared by the count and the cleanup so the
 * number in the confirmation dialog can never disagree with what the button
 * then closes.
 *
 * Stale means a visit that is still open — ACTIVE or PENDING_RETURN, the two
 * statuses that leave `checkOutTime` null — and belongs to a day that is over.
 * Status is the authority here rather than `checkOutTime IS NULL`, since a
 * visitor who stepped out and never came back is exactly as stale as one who
 * walked out without checking out.
 *
 * The date test accepts either timestamp. `exitTime` is never earlier than
 * `checkInTime`, so in practice `checkInTime` already catches every stale row;
 * naming `exitTime` too keeps the rule true of the record it describes instead
 * of relying on that ordering holding.
 */
function staleVisitsWhere(todayStart: Date): Prisma.VisitWhereInput {
  return {
    status: { in: ["ACTIVE", "PENDING_RETURN"] },
    OR: [
      { checkInTime: { lt: todayStart } },
      { exitTime: { lt: todayStart } },
    ],
  };
}

/**
 * Picks the timestamp a stale visit should be closed at.
 *
 * A visit that was PENDING_RETURN carries a real observation — `exitTime` is
 * the moment the guard saw them leave — so that beats a synthetic stamp. Only
 * when there is none does this fall back to end-of-day on the date the visit
 * began, which is the rule the cleanup has always used: a Monday visit must not
 * read as a three-day stay just because nobody ran the cleanup until Thursday.
 */
function closeTimeFor(visit: { checkInTime: Date; exitTime: Date | null }): Date {
  return visit.exitTime ?? endOfLocalDay(visit.checkInTime);
}

/**
 * Closes visits left open from a previous day.
 *
 * Deliberately standalone and parameterless: a button calls it today and a
 * scheduled job can call the same function later with no change. Nothing here
 * reads a request, a session or a cookie.
 */
export async function closeStaleVisits(): Promise<StaleVisitSummary> {
  const todayStart = startOfLocalDay();

  const stale = await prisma.visit.findMany({
    where: staleVisitsWhere(todayStart),
    select: { id: true, checkInTime: true, exitTime: true },
  });

  if (stale.length === 0) {
    return { closed: 0 };
  }

  // Visits that close at the same instant can share one UPDATE. Visits left
  // open overnight collapse onto their day's end-of-day stamp; ones that
  // stepped out keep their own `exitTime` and mostly end up alone in a group.
  const byCloseTime = new Map<number, { closeAt: Date; ids: string[] }>();

  for (const visit of stale) {
    const closeAt = closeTimeFor(visit);
    const group = byCloseTime.get(closeAt.getTime());

    if (group) {
      group.ids.push(visit.id);
    } else {
      byCloseTime.set(closeAt.getTime(), { closeAt, ids: [visit.id] });
    }
  }

  const closed = await prisma.$transaction(async (tx) => {
    let total = 0;

    for (const { closeAt, ids } of byCloseTime.values()) {
      // The open-status guard is re-applied here so a guard checking someone
      // out mid-run keeps their real timestamp.
      const { count } = await tx.visit.updateMany({
        where: { id: { in: ids }, status: { in: ["ACTIVE", "PENDING_RETURN"] } },
        data: { checkOutTime: closeAt, status: "CHECKED_OUT" },
      });

      total += count;
    }

    return total;
  });

  return { closed };
}

/** How many visits `closeStaleVisits()` would close, without changing anything. */
export async function countStaleVisits(): Promise<number> {
  return prisma.visit.count({ where: staleVisitsWhere(startOfLocalDay()) });
}
