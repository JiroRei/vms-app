/**
 * One-off repair for visits the stale-visit cleanup closed before
 * `closedAutomatically` and the AUTO_CLOSE event existed.
 *
 *   npm run db:repair-auto-closed -- --dry-run   # report only
 *   npm run db:repair-auto-closed                # apply
 *
 * Idempotent: a second run finds nothing to change. Run it once per
 * environment after the `auto_close_stale_visits` migration.
 *
 * 1. Flags auto-closed visits. Before the flag, "closed automatically" was
 *    inferred from a null `checkedOutByName` — but every checkout before
 *    attribution existed is unattributed too, so that alone would flag real
 *    two-hour visits. An unattributed visit is flagged only when it also shows
 *    a trace of the cleanup:
 *      a. it has no CHECK_OUT event (the cleanup never wrote one), or
 *      b. it closed exactly at the auto-close time on its check-in day, or
 *      c. it closed on a later day than it checked in (the earliest cleanup
 *         stamped the moment the button was pressed — no visit here is a
 *         genuine multi-day stay).
 * 2. Moves the closing time of a flagged visit that closed on a later day back
 *    to `closeTimeFor()` — the same rule the live cleanup uses.
 * 3. Gives every flagged visit an AUTO_CLOSE event at its closing time,
 *    converting a CHECK_OUT event where there is one (it described a checkout
 *    nobody performed) rather than leaving both.
 */
import "dotenv/config";

import { dateKeyInZone } from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { closeTimeFor } from "@/lib/stale-visits";

const dryRun = process.argv.includes("--dry-run");

/** The rule `closeStaleVisits()` applies, for a visit that is already closed. */
function expectedCloseTime(visit: { checkInTime: Date; exitTime: Date | null }) {
  // `exitTime` survives on a closed visit only if it was still stepped out
  // when it closed — a return clears it.
  return closeTimeFor({
    status: visit.exitTime ? "PENDING_RETURN" : "ACTIVE",
    checkInTime: visit.checkInTime,
    exitTime: visit.exitTime,
  });
}

function closedOnLaterDay(visit: { checkInTime: Date; checkOutTime: Date }) {
  return dateKeyInZone(visit.checkOutTime) > dateKeyInZone(visit.checkInTime);
}

async function main() {
  const candidates = await prisma.visit.findMany({
    where: {
      status: "CHECKED_OUT",
      checkOutTime: { not: null },
      OR: [
        { closedAutomatically: true },
        { checkedOutById: null, checkedOutByName: null },
      ],
    },
    select: {
      id: true,
      checkInTime: true,
      checkOutTime: true,
      exitTime: true,
      closedAutomatically: true,
      events: { select: { id: true, eventType: true, timestamp: true } },
    },
    orderBy: { checkInTime: "asc" },
  });

  const counts = { flagged: 0, timesFixed: 0, eventsConverted: 0, eventsAdded: 0 };

  for (const visit of candidates) {
    const checkOutTime = visit.checkOutTime!;
    const expected = expectedCloseTime(visit);
    const hasCheckOut = visit.events.some((e) => e.eventType === "CHECK_OUT");

    const isAutoClosed =
      visit.closedAutomatically ||
      !hasCheckOut ||
      checkOutTime.getTime() === expected.getTime() ||
      closedOnLaterDay({ checkInTime: visit.checkInTime, checkOutTime });

    if (!isAutoClosed) continue;

    const newCloseTime =
      closedOnLaterDay({ checkInTime: visit.checkInTime, checkOutTime }) &&
      checkOutTime.getTime() !== expected.getTime()
        ? expected
        : checkOutTime;

    const checkOuts = visit.events.filter((e) => e.eventType === "CHECK_OUT");
    const autoCloses = visit.events.filter((e) => e.eventType === "AUTO_CLOSE");

    const flag = !visit.closedAutomatically;
    const fixTime = newCloseTime.getTime() !== checkOutTime.getTime();
    const needsEvent = autoCloses.length === 0;

    if (!flag && !fixTime && checkOuts.length === 0 && !needsEvent) continue;

    if (flag) counts.flagged++;
    if (fixTime) {
      counts.timesFixed++;
      console.log(
        `  ${visit.id}: ${checkOutTime.toISOString()} -> ${newCloseTime.toISOString()} ` +
          `(checked in ${visit.checkInTime.toISOString()})`,
      );
    }
    counts.eventsConverted += checkOuts.length;
    if (needsEvent && checkOuts.length === 0) counts.eventsAdded++;

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id: visit.id },
        data: { closedAutomatically: true, checkOutTime: newCloseTime },
      });

      // A CHECK_OUT here described a checkout nobody performed: it becomes the
      // AUTO_CLOSE event, at the (possibly corrected) closing time.
      for (const event of checkOuts) {
        await tx.visitEvent.update({
          where: { id: event.id },
          data: { eventType: "AUTO_CLOSE", timestamp: newCloseTime },
        });
      }

      if (needsEvent && checkOuts.length === 0) {
        await tx.visitEvent.create({
          data: { visitId: visit.id, eventType: "AUTO_CLOSE", timestamp: newCloseTime },
        });
      }

      for (const event of autoCloses) {
        if (event.timestamp.getTime() !== newCloseTime.getTime()) {
          await tx.visitEvent.update({
            where: { id: event.id },
            data: { timestamp: newCloseTime },
          });
        }
      }
    });
  }

  console.log(dryRun ? "Dry run — nothing written." : "Applied.");
  console.log(`  visits flagged closedAutomatically: ${counts.flagged}`);
  console.log(`  closing times moved to check-in day: ${counts.timesFixed}`);
  console.log(`  CHECK_OUT events converted to AUTO_CLOSE: ${counts.eventsConverted}`);
  console.log(`  AUTO_CLOSE events added: ${counts.eventsAdded}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
