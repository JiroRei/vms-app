/**
 * Closing visits nobody checked out.
 *
 * The rule that matters is which timestamp a stale visit is closed at. Using
 * "now" would make a Monday visit read as a three-day stay because nobody ran
 * the cleanup until Thursday, so a visit left open collapses onto the end of
 * the day it began — and one that stepped out keeps its real `exitTime`,
 * because that is an actual observation of someone leaving.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { closeStaleVisits, countStaleVisits } from "@/lib/stale-visits";
import { markVisitReturning } from "@/lib/visits";

import { makeHost, makeVisit, readVisit, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => {
  await prisma.$disconnect();
});

/** Noon two days ago — unambiguously "a day that is over". */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
}

describe("what counts as stale", () => {
  test("today's open visits are left alone", async () => {
    const host = await makeHost();
    await makeVisit(host.id, { checkInTime: new Date() });

    assert.equal(await countStaleVisits(), 0);
    assert.equal((await closeStaleVisits()).closed, 0);
  });

  test("an already closed visit is not reopened or recounted", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id, { checkInTime: daysAgo(2) });

    const closedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.visit.update({
      where: { id: visit.id },
      data: { status: "CHECKED_OUT", checkOutTime: closedAt },
    });

    assert.equal(await countStaleVisits(), 0);
    assert.deepEqual((await readVisit(visit.id)).checkOutTime, closedAt);
  });

  test("the count and the cleanup always agree", async () => {
    const host = await makeHost();
    await makeVisit(host.id, { checkInTime: daysAgo(3) });
    await makeVisit(host.id, { checkInTime: daysAgo(1) });
    await makeVisit(host.id, { checkInTime: new Date() });

    const predicted = await countStaleVisits();
    const { closed } = await closeStaleVisits();

    assert.equal(predicted, 2);
    assert.equal(
      closed,
      predicted,
      "the dialog promises this number before the button is pressed",
    );
  });
});

describe("what it closes them at", () => {
  test("an abandoned visit closes at the end of the day it began", async () => {
    const host = await makeHost();
    const checkInTime = daysAgo(2);
    const { visit } = await makeVisit(host.id, { checkInTime });

    await closeStaleVisits();
    const closed = await readVisit(visit.id);

    assert.equal(closed.status, "CHECKED_OUT");
    assert.deepEqual(
      closed.checkOutTime,
      endOfLocalDay(checkInTime),
      "not 'now' — that would turn an old visit into a multi-day stay",
    );
  });

  test("a stepped-out visit closes at the moment it was seen leaving", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id, { checkInTime: daysAgo(2) });

    await markVisitReturning(visit.id);
    // Drag the exit back into the same past day the check-in sits in.
    const exitTime = daysAgo(2);
    exitTime.setHours(16, 45, 0, 0);
    await prisma.visit.update({ where: { id: visit.id }, data: { exitTime } });

    await closeStaleVisits();
    const closed = await readVisit(visit.id);

    assert.deepEqual(
      closed.checkOutTime,
      exitTime,
      "a real observation beats a synthetic end-of-day stamp",
    );
  });

  test("visits from different days each keep their own day's end", async () => {
    const host = await makeHost();
    const older = daysAgo(3);
    const newer = daysAgo(1);

    const { visit: a } = await makeVisit(host.id, { checkInTime: older });
    const { visit: b } = await makeVisit(host.id, { checkInTime: newer });

    await closeStaleVisits();

    assert.deepEqual((await readVisit(a.id)).checkOutTime, endOfLocalDay(older));
    assert.deepEqual((await readVisit(b.id)).checkOutTime, endOfLocalDay(newer));
  });
});

describe("day boundaries", () => {
  test("start of day is midnight local and end is the last millisecond", () => {
    const start = startOfLocalDay(new Date("2026-05-20T13:22:11.500Z"));
    assert.equal(start.getHours(), 0);
    assert.equal(start.getMinutes(), 0);
    assert.equal(start.getSeconds(), 0);
    assert.equal(start.getMilliseconds(), 0);

    const end = endOfLocalDay(new Date("2026-05-20T13:22:11.500Z"));
    assert.equal(end.getHours(), 23);
    assert.equal(end.getMinutes(), 59);
    assert.equal(end.getSeconds(), 59);
    assert.equal(end.getMilliseconds(), 999);
  });
});
