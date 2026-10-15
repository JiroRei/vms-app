/** Auto-close timestamps are observations or site closing time, never sweep time. */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { addDaysToKey, zonedTimeToUtc } from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { AUTO_CLOSE_TIME } from "@/lib/site-config";
import { closeStaleVisits, countStaleVisits } from "@/lib/stale-visits";
import { makeHost, makeVisit, readVisit, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

const today = "2026-10-12";
const now = zonedTimeToUtc(today, "12:00");
const daysAgo = (days: number, time = "12:00") => zonedTimeToUtc(addDaysToKey(today, -days), time);
const closingTime = (days: number) => new Date(zonedTimeToUtc(addDaysToKey(today, -days), AUTO_CLOSE_TIME).getTime() + 59_999);

describe("what counts as stale", () => {
  test("today's open visits are left alone", async () => {
    const host = await makeHost();
    await makeVisit(host.id, { checkInTime: now });
    assert.equal(await countStaleVisits(now), 0);
    assert.equal((await closeStaleVisits(now)).closed, 0);
  });

  test("a previously checked-out visit keeps its real departure", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id, { checkInTime: daysAgo(2) });
    const closedAt = daysAgo(2, "13:00");
    await prisma.visit.update({ where: { id: visit.id }, data: { status: "CHECKED_OUT", checkOutTime: closedAt } });
    assert.equal(await countStaleVisits(now), 0);
    assert.equal((await closeStaleVisits(now)).closed, 0);
    const row = await readVisit(visit.id);
    assert.deepEqual(row.checkOutTime, closedAt);
    assert.equal(row.closedAutomatically, false);
  });

  test("the count and cleanup agree and repeated sweeps do not duplicate events", async () => {
    const host = await makeHost();
    await makeVisit(host.id, { checkInTime: daysAgo(3) });
    await makeVisit(host.id, { checkInTime: daysAgo(1) });
    await makeVisit(host.id, { checkInTime: now });
    const count = await countStaleVisits(now);
    assert.equal(count, 2);
    assert.equal((await closeStaleVisits(now)).closed, count);
    assert.equal((await closeStaleVisits(now)).closed, 0);
    assert.equal(await prisma.visitEvent.count({ where: { eventType: "AUTO_CLOSE" } }), 2);
  });
});

describe("what it closes them at", () => {
  test("an abandoned visit closes at the site's configured minute end and is unattributed", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id, { checkInTime: daysAgo(2) });
    await closeStaleVisits(now);
    const closed = await readVisit(visit.id);
    assert.equal(closed.status, "CHECKED_OUT");
    assert.deepEqual(closed.checkOutTime, closingTime(2));
    assert.equal(closed.closedAutomatically, true);
    assert.equal(closed.checkedOutById, null);
    assert.equal(closed.checkedOutByName, null);
    assert.deepEqual((await prisma.visitEvent.findFirstOrThrow({ where: { visitId: visit.id, eventType: "AUTO_CLOSE" } })).timestamp, closingTime(2));
  });

  test("a pending-return visit keeps the time it was observed leaving", async () => {
    const host = await makeHost();
    const { visit } = await makeVisit(host.id, { checkInTime: daysAgo(2) });
    const exitTime = daysAgo(2, "16:45");
    await prisma.visit.update({ where: { id: visit.id }, data: { status: "PENDING_RETURN", exitTime } });
    await closeStaleVisits(now);
    const closed = await readVisit(visit.id);
    assert.deepEqual(closed.checkOutTime, exitTime);
    assert.equal(closed.closedAutomatically, true);
  });

  test("visits from different days each keep their own closing time", async () => {
    const host = await makeHost();
    const { visit: older } = await makeVisit(host.id, { checkInTime: daysAgo(3) });
    const { visit: newer } = await makeVisit(host.id, { checkInTime: daysAgo(1) });
    await closeStaleVisits(now);
    assert.deepEqual((await readVisit(older.id)).checkOutTime, closingTime(3));
    assert.deepEqual((await readVisit(newer.id)).checkOutTime, closingTime(1));
  });
});

describe("day boundaries", () => {
  test("23:50 yesterday closes while 00:10 today stays open in the site timezone", async () => {
    const host = await makeHost();
    const { visit: before } = await makeVisit(host.id, { checkInTime: daysAgo(1, "23:50") });
    const { visit: after } = await makeVisit(host.id, { checkInTime: daysAgo(0, "00:10") });
    assert.equal(await countStaleVisits(now), 1);
    await closeStaleVisits(now);
    assert.equal((await readVisit(before.id)).status, "CHECKED_OUT");
    assert.equal((await readVisit(after.id)).status, "ACTIVE");
  });

  test("the last minute is not swept until the next site day", async () => {
    const host = await makeHost();
    await makeVisit(host.id, { checkInTime: daysAgo(1, "23:50") });
    assert.equal(await countStaleVisits(daysAgo(1, "23:59")), 0);
    assert.equal(await countStaleVisits(daysAgo(0, "00:00")), 1);
  });
});
