import "server-only";

import type { VisitStatus } from "@/generated/prisma/enums";
import {
  addDaysToKey,
  dateKeyInZone,
  zonedTimeToUtc,
} from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { AUTO_CLOSE_TIME } from "@/lib/site-config";
import { logger, reportError } from "@/lib/logger";

export type StaleVisitSummary = {
  /** How many visits were closed by this run. */
  closed: number;
};

const OPEN_STATUSES: VisitStatus[] = ["ACTIVE", "PENDING_RETURN"];

/** `AUTO_CLOSE_TIME` names a minute; the visit closes at its last millisecond. */
const END_OF_MINUTE_MS = 59_999;

/** The fields the closing rule reads. */
type ClosableVisit = {
  status: VisitStatus;
  checkInTime: Date;
  exitTime: Date | null;
};

/**
 * The moment a stale visit is closed at. Computed per visit from the visit
 * alone, so it is the same whether the sweep runs at 23:59 or at 8 AM the next
 * day — or from the repair script weeks later.
 *
 * A visit that was PENDING_RETURN carries a real observation — `exitTime` is
 * the moment the guard saw them leave — so that beats a synthetic stamp.
 * Anything else closes at `AUTO_CLOSE_TIME` on its check-in day in
 * `SITE_TIMEZONE`, or at the next occurrence after check-in when the configured
 * time comes earlier in the day than the arrival (a site that runs overnight).
 */
export function closeTimeFor(visit: ClosableVisit): Date {
  if (visit.status === "PENDING_RETURN" && visit.exitTime) {
    return visit.exitTime;
  }

  const checkInDay = dateKeyInZone(visit.checkInTime);
  const sameDay = autoCloseOn(checkInDay);

  return sameDay.getTime() >= visit.checkInTime.getTime()
    ? sameDay
    : autoCloseOn(addDaysToKey(checkInDay, 1));
}

function autoCloseOn(dateKey: string): Date {
  return new Date(
    zonedTimeToUtc(dateKey, AUTO_CLOSE_TIME).getTime() + END_OF_MINUTE_MS,
  );
}

/**
 * Open visits whose check-in day has ended, each with the time it closes at.
 *
 * Stale means still open — ACTIVE or PENDING_RETURN, the two statuses that
 * leave `checkOutTime` null — and checked in on a day that is over in
 * `SITE_TIMEZONE`. The database narrows on the day; the closing time itself is
 * checked here, because under an overnight `AUTO_CLOSE_TIME` yesterday's late
 * arrival may still be due to close later this morning, and a visit is never
 * closed at a time that has not happened yet.
 *
 * Shared by the count and the cleanup so the number in the confirmation dialog
 * can never disagree with what the button then closes.
 */
async function findDueVisits(now: Date) {
  const todayStart = zonedTimeToUtc(dateKeyInZone(now), "00:00");

  const candidates = await prisma.visit.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      checkInTime: { lt: todayStart },
    },
    select: { id: true, status: true, checkInTime: true, exitTime: true },
  });

  return candidates
    .map((visit) => ({ id: visit.id, closeAt: closeTimeFor(visit) }))
    .filter(({ closeAt }) => closeAt.getTime() <= now.getTime());
}

/**
 * Closes stale visits — the one function behind the dashboard button, the
 * scheduler endpoint and the sweep that runs before the live list and history
 * are read.
 *
 * Each visit is stamped with its own `closeTimeFor()`, flagged
 * `closedAutomatically`, left unattributed (nobody closed it), and given an
 * AUTO_CLOSE event at the same instant so its timeline says what happened.
 *
 * Takes no request, session or cookie. `now` is a parameter only so the
 * boundary can be tested; every caller passes nothing.
 */
export async function closeStaleVisits(
  now: Date = new Date(),
): Promise<StaleVisitSummary> {
  const due = await findDueVisits(now);

  if (due.length === 0) {
    return { closed: 0 };
  }

  const closed = await prisma.$transaction(async (tx) => {
    let total = 0;

    for (const { id, closeAt } of due) {
      // The open-status guard is re-applied so a guard checking someone out
      // mid-run keeps their real timestamp — and so a second sweep racing this
      // one matches nothing and writes no duplicate event.
      const { count } = await tx.visit.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: {
          checkOutTime: closeAt,
          status: "CHECKED_OUT",
          closedAutomatically: true,
          checkedOutById: null,
          checkedOutByName: null,
        },
      });

      if (count > 0) {
        await tx.visitEvent.create({
          data: { visitId: id, eventType: "AUTO_CLOSE", timestamp: closeAt },
        });
        total += count;
      }
    }

    return total;
  });

  return { closed };
}

/** How many visits `closeStaleVisits()` would close, without changing anything. */
export async function countStaleVisits(now: Date = new Date()): Promise<number> {
  return (await findDueVisits(now)).length;
}

/** How often a read may trigger the sweep, per server process. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Kept on `globalThis` rather than in module scope: Next.js can load this
 * module more than once in one process (route handlers and server components
 * are bundled separately, and dev reloads re-evaluate it), and the throttle
 * has to be per process, not per copy of the module.
 */
const sweepState = globalThis as unknown as {
  staleSweep?: { lastStartedAt: number; running: Promise<void> | null };
};

/**
 * Closes stale visits before a read, at most once a minute.
 *
 * Called by the live list and history queries so yesterday's visitors never
 * show as on site, with or without a scheduler. The dashboard polls every few
 * seconds; the throttle keeps that from becoming a write query per poll.
 * Concurrent readers during a run wait for that run rather than starting their
 * own.
 *
 * Never throws: a failed sweep is logged and the read goes ahead, since
 * showing the list matters more than tidying it.
 */
export async function sweepStaleVisitsIfDue(): Promise<void> {
  const state = (sweepState.staleSweep ??= { lastStartedAt: 0, running: null });

  if (state.running) {
    return state.running;
  }

  if (Date.now() - state.lastStartedAt < SWEEP_INTERVAL_MS) {
    return;
  }

  state.lastStartedAt = Date.now();
  state.running = closeStaleVisits()
    .then(({ closed }) => {
      if (closed > 0) {
        logger.info("Stale visits auto-closed", { closed });
      }
    })
    .catch(async (error) => {
      await reportError(error, { operation: "staleVisitSweep" });
    })
    .finally(() => {
      state.running = null;
    });

  return state.running;
}
