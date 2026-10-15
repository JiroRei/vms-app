import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { getHistoryQuery, getVisitHistory } from "@/lib/history";
import { prisma } from "@/lib/prisma";
import { getDailyRegister } from "@/lib/register";
import { createVisitExport, CSV_COLUMNS } from "@/lib/visit-export";
import { csvRow, reportCheckInMethod, reportTimestamp } from "@/lib/visit-report";
import { createDeliveryLog } from "@/lib/visits";

const prefix = `report-${randomUUID()}`;
const today = dateKeyInZone(new Date());
const yesterday = addDaysToKey(today, -1);
const userId = `${prefix}-user`;
const hostId = `${prefix}-host`;
const visitorIds = Array.from({ length: 1007 }, (_, index) => `${prefix}-visitor-${index}`);

before(async () => {
  await prisma.user.create({ data: { id: userId, email: `${prefix}@example.invalid`, name: "Report tester", role: "ADMIN" } });
  await prisma.host.create({ data: { id: hostId, name: 'Host, "Quoted"', department: "Reports" } });
  await prisma.visitor.createMany({ data: visitorIds.map((id, index) => ({
    id, firstName: index === 0 ? "José" : index === 1 ? "=1+1" : "Report",
    lastName: prefix, hostId, type: index === 2 ? "DELIVERY" : "GUEST",
  })) });
  await prisma.visit.createMany({ data: visitorIds.map((visitorId, index) => ({
    id: `${prefix}-visit-${index}`, visitorId,
    checkInTime: index === 1005 ? zonedTimeToUtc(yesterday, "23:50") : index === 1006 ? zonedTimeToUtc(today, "00:10") : zonedTimeToUtc(today, "01:00"),
    status: index === 3 ? "ACTIVE" : index === 4 ? "PENDING_RETURN" : "CHECKED_OUT",
    checkOutTime: index === 3 || index === 4 ? null : index === 1005 ? zonedTimeToUtc(yesterday, "23:55") : zonedTimeToUtc(today, "02:00"),
    closedAutomatically: index === 5,
    checkInMethod: index === 2 ? "DELIVERY" : index === 0 ? "PASS" : "WALK_IN",
    checkedInBy: null,
    checkedOutByName: index === 2 ? "Report tester" : null,
  })) });
  await prisma.appointment.create({ data: {
    referenceNumber: `${prefix}-appointment`, qrToken: randomUUID(),
    firstName: "Report", lastName: prefix, visitorEmail: `${prefix}@example.invalid`,
    hostId, scheduledFor: zonedTimeToUtc(today, "01:00"), expiresAt: zonedTimeToUtc(today, "02:00"),
    status: "CHECKED_IN", visitId: `${prefix}-visit-1`,
  } });
});

after(async () => {
  await prisma.exportLog.deleteMany({ where: { userId } });
  await prisma.visit.deleteMany({ where: { visitorId: { in: visitorIds } } });
  await prisma.appointment.deleteMany({ where: { referenceNumber: `${prefix}-appointment` } });
  await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } });
  await prisma.host.deleteMany({ where: { id: hostId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

test("CSV encoding, quoting, injection protection and site timestamps", () => {
  assert.equal(csvRow(["José", 'a,"b"', "line\nnext", "=1+1", "+x", "-x", "@x", "\t=1", null]),
    '"José","a,""b""","line\r\nnext","\'=1+1","\'+x","\'-x","\'@x","\'\t=1",""\r\n');
  assert.equal(reportTimestamp(new Date("2026-10-11T15:50:00Z")), "2026-10-11 23:50");
  assert.equal(reportTimestamp(new Date("2026-10-11T16:10:00Z")), "2026-10-12 00:10");
  for (const [checkInMethod, expected] of [["WALK_IN", "walk-in"], ["PASS", "pass"], ["APPOINTMENT", "appointment QR"], ["DELIVERY", "guard-assisted"]] as const) {
    assert.equal(reportCheckInMethod({ checkInMethod, checkedInBy: null, appointment: null }), expected);
  }
  assert.equal(reportCheckInMethod({ checkInMethod: "APPOINTMENT", checkedInBy: userId, appointment: null }), "guard-assisted");
});

test("shared filters use site boundaries and normalize invalid/repeated parameters", () => {
  const query = getHistoryQuery({ from: today, to: today, type: "DELIVERY", search: "  José  ", page: "-7" });
  assert.equal(query.filters.search, "José");
  assert.equal(query.filters.page, 1);
  assert.deepEqual(query.where.checkInTime, { gte: zonedTimeToUtc(today, "00:00"), lt: zonedTimeToUtc(addDaysToKey(today, 1), "00:00") });
  assert.deepEqual(query.where.visitor && (query.where.visitor as { type: string }).type, "DELIVERY");
  assert.equal(getHistoryQuery({ from: "2026-02-31", to: "bad", search: ["a", "b"] }).filters.from, "");
  assert.equal(getHistoryQuery({ hideDeliveries: "1" }).filters.hideDeliveries, true);
});

test("export spans 1,000-row batches and matches history total rather than its page", async () => {
  const query = getHistoryQuery({ search: prefix, from: today, to: today, hostId, page: "2" });
  const history = await getVisitHistory(query);
  assert.equal(history.total, 1006);
  assert.equal(history.visits.length, 25);
  const stream = await createVisitExport(userId, query);
  const bytes = Buffer.from(await new Response(stream).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = bytes.toString("utf8").slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length - 1, history.total);
  assert.equal(lines[0], csvRow(CSV_COLUMNS).trimEnd());
  assert.ok(lines.some((line) => line.includes('"José"')));
  assert.ok(lines.some((line) => line.includes('"\'=1+1"')));
  assert.ok(lines.some((line) => line.endsWith('"auto-closed",""')));
  assert.ok(lines.some((line) => line.includes('"guard-assisted","Report tester"')));
  assert.ok(lines.some((line) => line.includes(`"appointment QR","","${prefix}-appointment"`)));
  assert.ok(lines.some((line) => line.includes('"out and returning"')));
  const log = await prisma.exportLog.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  assert.equal(log.rowCount, history.total);
  assert.deepEqual(log.filters, { search: prefix, from: today, to: today, hostId, type: "", hideDeliveries: false });
});

test("new guard delivery logs record who checked the courier in", async () => {
  const delivery = await createDeliveryLog({ name: "Report courier", loggedBy: { id: userId, name: "Report tester" }, hostId: null, recipientDepartment: "Receiving", note: null });
  visitorIds.push(delivery.visitorId);
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id: delivery.visitId } });
  assert.equal(visit.checkedInBy, userId);
  assert.equal(visit.checkInMethod, "DELIVERY");
});

test("name, host and type filters match across history and CSV, including empty exports", async () => {
  for (const params of [{ search: "José", type: "GUEST" }, { type: "DELIVERY" }, { hideDeliveries: "1" }, { search: "nonexistent" }]) {
    const query = getHistoryQuery({ ...params, hostId, from: today, to: today });
    const history = await getVisitHistory(query);
    const csv = await new Response(await createVisitExport(userId, query)).text();
    assert.equal(csv.trimEnd().split("\r\n").length - 1, history.total);
  }
});

test("register has deliveries, on-site, auto-closed, returning and midnight boundaries", async () => {
  const register = await getDailyRegister(today);
  const fixtures = register.visits.filter((visit) => visit.visitor.hostId === hostId);
  assert.equal(fixtures.length, 1006);
  assert.ok(fixtures.some((visit) => visit.visitor.type === "DELIVERY"));
  assert.ok(fixtures.some((visit) => visit.status === "ACTIVE"));
  assert.ok(fixtures.some((visit) => visit.status === "PENDING_RETURN"));
  assert.ok(fixtures.some((visit) => visit.closedAutomatically));
  assert.ok(fixtures.some((visit) => visit.id === `${prefix}-visit-1006`));
  assert.ok(!fixtures.some((visit) => visit.id === `${prefix}-visit-1005`));
  assert.ok((await getDailyRegister(yesterday)).visits.some((visit) => visit.id === `${prefix}-visit-1005`));
  assert.equal(register.summary.total, register.visits.length);
  assert.equal(register.summary.onSite, register.visits.filter((visit) => !visit.closedAutomatically && visit.status === "ACTIVE").length);
  for (let i = 1; i < register.visits.length; i++) assert.ok(register.visits[i - 1].checkInTime <= register.visits[i].checkInTime);
});
