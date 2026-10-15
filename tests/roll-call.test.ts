import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { prisma } from "@/lib/prisma";
import { getRollCall } from "@/lib/roll-call";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { makeHost, makeVisit, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

test("roll-call separates active and returning visitors, excludes deliveries/closed visits, and closes stale visits before reading", async () => {
  const now = new Date();
  const today = dateKeyInZone(now);
  const host = await makeHost({ name: "Alpha Host", department: "Reception" });
  const other = await makeHost({ name: "Zulu Host", department: "Operations" });
  const bob = await makeVisit(host.id, { name: "Bob Present", checkInTime: now });
  const alice = await makeVisit(host.id, { name: "Alice Present", checkInTime: now });
  const zed = await makeVisit(other.id, { name: "Aaron Present", checkInTime: now });
  const out = await makeVisit(host.id, { name: "Out Returning", checkInTime: now });
  await prisma.visit.update({ where: { id: out.visit.id }, data: { status: "PENDING_RETURN", exitTime: now } });
  const closed = await makeVisit(host.id, { name: "Already Closed", checkInTime: now });
  await prisma.visit.update({ where: { id: closed.visit.id }, data: { status: "CHECKED_OUT", checkOutTime: now } });
  const delivery = await makeVisit(host.id, { name: "Logged Delivery", checkInTime: now });
  await prisma.visitor.update({ where: { id: delivery.visitor.id }, data: { type: "DELIVERY" } });
  // Exclude even a legacy delivery incorrectly left active.
  const stale = await makeVisit(host.id, { name: "Yesterday Visitor", checkInTime: zonedTimeToUtc(addDaysToKey(today, -1), "09:00") });
  const staleOut = await makeVisit(host.id, { name: "Yesterday Returning", checkInTime: zonedTimeToUtc(addDaysToKey(today, -1), "09:00") });
  await prisma.visit.update({ where: { id: staleOut.visit.id }, data: { status: "PENDING_RETURN", exitTime: zonedTimeToUtc(addDaysToKey(today, -1), "10:00") } });
  const result = await getRollCall(now);
  assert.deepEqual(result.onSite.map(visit => visit.id), [alice.visit.id, bob.visit.id, zed.visit.id]);
  assert.deepEqual(result.expectedBack.map(visit => visit.id), [out.visit.id]);
  assert.equal(result.expectedBack[0].exitTime, now.toISOString());
  assert.equal(result.onSite[0].destination, "Alpha Host");
  for (const id of [stale.visit.id, staleOut.visit.id]) {
    const row = await prisma.visit.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "CHECKED_OUT");
    assert.equal(row.closedAutomatically, true);
  }
});

test("roll-call sorts typed destinations with host names and returns empty sections when no visits remain", async () => {
  const now = new Date();
  const host = await makeHost({ name: "Zulu Host" });
  const visit = await makeVisit(host.id, { name: "Hosted Guest", checkInTime: now });
  const destination = await makeVisit(null, { name: "Destination Guest", checkInTime: now });
  await prisma.visitor.update({ where: { id: destination.visitor.id }, data: { recipientDepartment: "Alpha Office" } });
  assert.deepEqual((await getRollCall(now)).onSite.map(row => row.destination), ["Alpha Office", "Zulu Host"]);
  await prisma.visit.updateMany({ where: { id: { in: [visit.visit.id, destination.visit.id] } }, data: { status: "CHECKED_OUT", checkOutTime: now } });
  const empty = await getRollCall(now);
  assert.deepEqual(empty.onSite, []); assert.deepEqual(empty.expectedBack, []);
});
