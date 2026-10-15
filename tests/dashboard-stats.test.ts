import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { prisma } from "@/lib/prisma";
import { makeAppointment, makeHost, makeVisit, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

test("counts statuses separately and keeps deliveries off the on-site figure", async () => {
  const now = new Date();
  const host = await makeHost();

  const active = await makeVisit(host.id, { name: "Active Guest", checkInTime: now });
  const out = await makeVisit(host.id, { name: "Out Guest", checkInTime: now });
  await prisma.visit.update({ where: { id: out.visit.id }, data: { status: "PENDING_RETURN", exitTime: now } });
  const closed = await makeVisit(host.id, { name: "Closed Guest", checkInTime: now });
  await prisma.visit.update({ where: { id: closed.visit.id }, data: { status: "CHECKED_OUT", checkOutTime: now } });

  // A delivery left ACTIVE must still not read as a hosted visitor on site.
  const delivery = await makeVisit(host.id, { name: "Logged Delivery", checkInTime: now });
  await prisma.visitor.update({ where: { id: delivery.visitor.id }, data: { type: "DELIVERY" } });

  const stats = await getDashboardStats(now);
  assert.equal(stats.onSite, 1);
  assert.equal(stats.outReturning, 1);
  assert.equal(stats.visitorsToday, 3);
  assert.equal(stats.deliveriesToday, 1);
  assert.notEqual(active.visit.id, out.visit.id);
});

test("today's window follows the building's clock across midnight", async () => {
  const now = new Date();
  const today = dateKeyInZone(now);
  const yesterday = addDaysToKey(today, -1);
  const host = await makeHost();

  // Same wall-clock hour either side of midnight, a day apart.
  await makeVisit(host.id, { name: "Late Yesterday", checkInTime: zonedTimeToUtc(yesterday, "23:50") });
  await makeVisit(host.id, { name: "Early Today", checkInTime: zonedTimeToUtc(today, "00:10") });
  const oldDelivery = await makeVisit(host.id, { name: "Yesterday Delivery", checkInTime: zonedTimeToUtc(yesterday, "23:50") });
  await prisma.visitor.update({ where: { id: oldDelivery.visitor.id }, data: { type: "DELIVERY" } });
  const todayDelivery = await makeVisit(host.id, { name: "Today Delivery", checkInTime: zonedTimeToUtc(today, "00:10") });
  await prisma.visitor.update({ where: { id: todayDelivery.visitor.id }, data: { type: "DELIVERY" } });

  const stats = await getDashboardStats(now);
  assert.equal(stats.visitorsToday, 1);
  assert.equal(stats.deliveriesToday, 1);
  assert.equal(stats.onSite, 1);
});

test("cancelled appointments drop out of both counts; only today's non-cancelled ones book", async () => {
  const now = new Date();
  const today = dateKeyInZone(now);
  const host = await makeHost();

  await makeAppointment(host.id, {
    referenceNumber: "APT-PENDING",
    status: "PENDING",
    scheduledFor: zonedTimeToUtc(today, "09:00"),
  });
  await makeAppointment(host.id, {
    referenceNumber: "APT-CANCELLED",
    status: "CANCELLED",
    scheduledFor: zonedTimeToUtc(today, "10:00"),
  });
  await makeAppointment(host.id, {
    referenceNumber: "APT-CHECKED-IN",
    status: "CHECKED_IN",
    scheduledFor: zonedTimeToUtc(today, "11:00"),
  });
  await makeAppointment(host.id, {
    referenceNumber: "APT-TOMORROW",
    status: "PENDING",
    scheduledFor: zonedTimeToUtc(addDaysToKey(today, 1), "09:00"),
  });

  const stats = await getDashboardStats(now);
  assert.equal(stats.appointmentsStillExpected, 1);
  assert.equal(stats.appointmentsBookedToday, 2);
});

test("a stale visit from a previous day is closed before it can be counted as on site", async () => {
  const now = new Date();
  const today = dateKeyInZone(now);
  const host = await makeHost();

  const stale = await makeVisit(host.id, {
    name: "Stale Guest",
    checkInTime: zonedTimeToUtc(addDaysToKey(today, -1), "09:00"),
  });

  const stats = await getDashboardStats(now);
  assert.equal(stats.onSite, 0);

  const row = await prisma.visit.findUniqueOrThrow({ where: { id: stale.visit.id } });
  assert.equal(row.status, "CHECKED_OUT");
  assert.equal(row.closedAutomatically, true);
});
