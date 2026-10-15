/** Manual integration check against the running local dev server; cleans its own fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";

async function main() {
  const origin = "http://localhost:3000";
  const prefix = `http-report-${randomUUID()}`;
  const today = dateKeyInZone(new Date());
  const yesterday = addDaysToKey(today, -1);
  const userIds = [`${prefix}-admin`, `${prefix}-guard`];
  const visitorIds = Array.from({ length: 7 }, (_, i) => `${prefix}-visitor-${i}`);
  const password = randomUUID();
  const passwordHash = await hashPassword(password);
  const hostId = `${prefix}-host`;
  try {
    for (const [i, id] of userIds.entries()) {
      await prisma.user.create({ data: { id, name: `Report ${i === 0 ? "Admin" : "Guard"}`, email: `${id}@example.invalid`, role: i === 0 ? "ADMIN" : "GUARD", emailVerified: true } });
      await prisma.account.create({ data: { id, accountId: id, userId: id, providerId: "credential", password: passwordHash } });
    }
    await prisma.host.create({ data: { id: hostId, name: "Report Host", department: "QA" } });
    await prisma.visitor.createMany({ data: visitorIds.map((id, i) => ({ id, firstName: i === 0 ? "José" : i === 1 ? "=1+1" : "Register", lastName: prefix, hostId, type: i === 2 ? "DELIVERY" : "GUEST" })) });
    await prisma.visit.createMany({ data: visitorIds.map((visitorId, i) => ({
      id: `${prefix}-visit-${i}`, visitorId, checkInTime: zonedTimeToUtc(i === 5 ? yesterday : today, i === 5 ? "23:50" : i === 6 ? "00:10" : "01:00"),
      status: i === 0 ? "ACTIVE" : i === 3 ? "PENDING_RETURN" : "CHECKED_OUT",
      checkOutTime: i === 0 || i === 3 ? null : zonedTimeToUtc(i === 5 ? yesterday : today, i === 5 ? "23:55" : "02:00"),
      closedAutomatically: i === 4, checkInMethod: i === 2 ? "DELIVERY" : "WALK_IN", checkedInBy: i === 2 ? userIds[1] : null,
    })) });
    const cookies = [];
    for (const id of userIds) {
      const login = await fetch(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: `${id}@example.invalid`, password }) });
      assert.equal(login.status, 200, await login.text());
      cookies.push(login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "));
    }
    const qs = new URLSearchParams({ search: prefix, from: today, to: today, hostId });
    const adminHistory = await fetch(`${origin}/dashboard/history?${qs}`, { headers: { Cookie: cookies[0] } });
    assert.equal(adminHistory.status, 200);
    const historyHtml = await adminHistory.text();
    assert.match(historyHtml, /Showing 1[–-]6 of 6/);
    assert.ok(historyHtml.includes("Export CSV"));
    const csvResponse = await fetch(`${origin}/api/visits/export?${qs}`, { headers: { Cookie: cookies[0] } });
    assert.equal(csvResponse.status, 200);
    assert.equal(csvResponse.headers.get("content-disposition"), `attachment; filename="visits_${today}_to_${today}.csv"`);
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
    assert.deepEqual([...csvBytes.subarray(0, 3)], [239, 187, 191]);
    const csv = csvBytes.toString("utf8");
    assert.equal(csv.trimEnd().split("\r\n").length - 1, 6);
    assert.ok(csv.includes('"José"'));
    assert.ok(csv.includes('"\'=1+1"'));
    assert.ok(csv.includes('"guard-assisted","Report Guard"'));
    const guardExport = await fetch(`${origin}/api/visits/export?${qs}`, { headers: { Cookie: cookies[1] } });
    assert.equal(guardExport.status, 403);
    assert.equal((await fetch(`${origin}/api/visits/export`)).status, 403);
    const guardHistory = await fetch(`${origin}/dashboard/history?${qs}`, { headers: { Cookie: cookies[1] } });
    assert.ok(!(await guardHistory.text()).includes("Export CSV"));
    const registerResponse = await fetch(`${origin}/dashboard/register?date=${today}`, { headers: { Cookie: cookies[1] } });
    assert.equal(registerResponse.status, 200);
    const registerHtml = await registerResponse.text();
    const tableHtml = registerHtml.slice(registerHtml.indexOf('<table'), registerHtml.indexOf('</table>'));
    for (const label of ["On site", "Auto-closed", "Out (returning)", "Delivery", "Time in", "Time out"]) assert.ok(tableHtml.includes(label), label);
    assert.ok(tableHtml.includes("00:10"));
    assert.ok(!tableHtml.includes(`${prefix}-visit-5`));
    assert.ok(registerHtml.includes("Printed by"));
    assert.ok(registerHtml.includes("Report Guard"));
    const previousRegister = await fetch(`${origin}/dashboard/register?date=${yesterday}`, { headers: { Cookie: cookies[1] } });
    assert.ok((await previousRegister.text()).includes("23:50"));
    console.log("HTTP checks passed: history/CSV count 6, BOM/accents/injection, audit, ADMIN/guard permissions, register statuses and midnight boundaries.");
    const log = await prisma.exportLog.findFirstOrThrow({ where: { userId: userIds[0] } });
    assert.equal(log.rowCount, 6);
  } finally {
    await prisma.exportLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.visit.deleteMany({ where: { visitorId: { in: visitorIds } } });
    await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } });
    await prisma.host.deleteMany({ where: { id: hostId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    console.log("Temporary HTTP verification fixtures removed.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
