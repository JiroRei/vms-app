import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { isolatedTestUrl } from "../test-database";
import { sentMail } from "../e2e-mail";
import { availableSlots, bookableRange, dateKeyInZone, zonedTimeToUtc, toSlotValue } from "../../src/lib/booking-config";
import { AUTO_CLOSE_TIME } from "../../src/lib/site-config";

const url = isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: new URL(url).searchParams.get("schema")! }) });
test.afterAll(() => db.$disconnect());
async function login(page: Page, role = "guard") {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(`${role}@e2e.invalid`);
  await page.getByLabel("Password", { exact: true }).fill("E2ePassword123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function openKiosk(page: Page, path: string) {
  // The first heartbeat comes from an effect, so it also confirms hydration.
  // Network-idle is unsuitable for a kiosk with recurring background requests.
  const ready = page.waitForRequest(request => request.url().endsWith("/api/kiosk/heartbeat"));
  await page.goto(path);
  await ready;
}

test("new-device creation is limited; admins dismiss pending browsers without affecting status", async ({ page, request }) => {
  const deviceIds = Array.from({ length: 6 }, () => randomUUID());
  const headers = { "x-forwarded-for": "192.0.2.240" };
  await page.setExtraHTTPHeaders(headers);
  try {
    for (let i = 0; i < deviceIds.length; i++) {
      const response = await request.post("/api/kiosk/heartbeat", { headers, data: { deviceId: deviceIds[i] } });
      expect(response.status()).toBe(i === 5 ? 429 : 200);
      if (i === 5) expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
    }
    expect((await request.post("/api/kiosk/heartbeat", { headers, data: { deviceId: deviceIds[0] } })).status()).toBe(200);
    expect(await db.kioskDevice.count({ where: { deviceId: { in: deviceIds }, registrationStatus: "PENDING" } })).toBe(5);
    await login(page);
    const device = await db.kioskDevice.findUniqueOrThrow({ where: { deviceId: deviceIds[0] } });
    expect((await page.request.patch("/api/kiosks", { data: { id: device.id, action: "approve" } })).status()).toBe(403);
    await login(page, "admin");
    const chip = page.getByRole("button", { name: /^Kiosks:/ });
    await expect(chip).toHaveText("Kiosks: Online");
    await chip.click();
    const row = page.getByRole("region", { name: "Unconfirmed devices" }).locator("div").filter({ hasText: device.id });
    await row.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(chip).toHaveText("Kiosks: Online");
    expect((await request.post("/api/kiosk/heartbeat", { headers, data: { deviceId: deviceIds[0] } })).status()).toBe(200);
    expect((await db.kioskDevice.findUniqueOrThrow({ where: { id: device.id } })).registrationStatus).toBe("RETIRED");
  } finally { await db.kioskDevice.deleteMany({ where: { deviceId: { in: deviceIds } } }); }
});

test("walk-in appears live, steps out, returns and checks out", async ({ page, context }) => {
  const kiosk = await context.newPage();
  await openKiosk(kiosk, "/check-in/walkin");
  await kiosk.getByLabel("First name", { exact: true }).fill("Walkin");
  await kiosk.getByLabel("Last name", { exact: true }).fill("E2e");
  await kiosk.getByLabel("Purpose of Visit").selectOption("e2e-purpose");
  await kiosk.getByLabel("Host / Department").selectOption("e2e-host");
  await kiosk.getByRole("button", { name: "Check In", exact: true }).click();
  await expect(kiosk.getByRole("heading", { name: /checked in/i })).toBeVisible();
  await login(page);
  const row = page.getByRole("row").filter({ hasText: "Walkin E2e" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Check out", exact: true }).click();
  await page.getByRole("button", { name: "Yes, mark as returning" }).click();
  await expect(row.getByRole("button", { name: "Mark as returned" })).toBeVisible();
  await row.getByRole("button", { name: "Mark as returned" }).click();
  await expect(row.getByRole("button", { name: "Mark as returned" })).toHaveCount(0);
  await row.getByRole("button", { name: "Check out", exact: true }).click();
  await page.getByRole("button", { name: "No, check out" }).click();
  await expect(row).toHaveCount(0);
  const visit = await db.visit.findFirstOrThrow({ where: { visitor: { firstName: "Walkin", lastName: "E2e" } }, include: { events: { orderBy: { timestamp: "asc" } } } });
  expect(visit.events.map(event => event.eventType)).toEqual(["CHECK_IN", "STEP_OUT", "RETURN", "CHECK_OUT"]);
  await kiosk.close();
});

test("new booking checks in using manually entered reference number", async ({ page, request }) => {
  const now = new Date();
  const day = bookableRange(now).first;
  const slot = availableSlots(day, now)[0];
  const response = await request.post("/api/appointments", { data: { firstName: "Booked", lastName: "E2e", visitorEmail: "booked@e2e.invalid", hostId: "e2e-host-two", purposeId: "e2e-purpose", scheduledFor: toSlotValue(day, slot), consent: true } });
  expect(response.status()).toBe(201);
  const { appointment } = await response.json();
  // Move only this test appointment into today's check-in window so the case works at any wall-clock hour.
  await db.appointment.update({ where: { referenceNumber: appointment.referenceNumber }, data: { scheduledFor: now, expiresAt: new Date(now.getTime() + 4 * 3600_000) } });
  await openKiosk(page, "/check-in/appointment");
  await page.getByLabel("Or enter your appointment reference number").fill(appointment.referenceNumber);
  // The self-service kiosk also needs the last name on the booking.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Please enter the last name used on the booking.")).toBeVisible();
  await page.getByLabel("Last name used on the booking").fill("Wrong");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Booked E2e", { exact: true })).toHaveCount(0);
  await page.getByLabel("Last name used on the booking").fill("e2e");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Booked E2e", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yes, check me in" }).click();
  await expect(page.getByRole("heading", { name: /checked in/i })).toBeVisible();
  expect((await db.appointment.findUniqueOrThrow({ where: { referenceNumber: appointment.referenceNumber } })).status).toBe("CHECKED_IN");
});

test("returning visitor signs in with the emailed code; the outbox keeps no copy", async ({ page }) => {
  await page.goto("/appointment-booking", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /I've been here before/ }).click();
  const fallback = page.getByRole("button", { name: /use name and email/ });
  await expect(fallback).toBeVisible();
  await fallback.click();
  await page.getByLabel("First name", { exact: true }).fill("Returning");
  await page.getByLabel("Last name", { exact: true }).fill("Visitor");
  await page.getByLabel("Email", { exact: true }).fill("returning@e2e.invalid");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.locator("#lookupCode")).toBeVisible();
  let code = "";
  await expect.poll(async () => {
    const mail = sentMail().filter((item) => item.to === "returning@e2e.invalid" && item.kind === "verification").at(-1);
    code = mail?.text.match(/\b\d{6}\b/)?.[0] ?? "";
    return code.length;
  }).toBe(6);
  // KNOWN_ISSUES M-05: once sent, the outbox row is metadata only.
  const row = await db.emailOutbox.findFirstOrThrow({ where: { to: "returning@e2e.invalid", kind: "verification", status: "SENT" }, orderBy: { createdAt: "desc" } });
  expect([row.html, row.text, row.attachments, row.subject.includes(code)]).toEqual(["", "", [], false]);
  await page.locator("#lookupCode").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "About your visit" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#visitorEmail")).toHaveValue("returning@e2e.invalid");
});

test("guard logs a delivery and finds it in history", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Log delivery", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Courier / company name").fill("E2E Courier");
  await dialog.getByRole("button", { name: "Log delivery", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/dashboard/history");
  await expect(page.getByRole("row").filter({ hasText: "E2E Courier" })).toBeVisible();
});

test("guard is blocked from admin pages; admin can open them", async ({ page, context }) => {
  await login(page);
  for (const path of ["/dashboard/staff", "/dashboard/hosts", "/dashboard/settings/purposes", "/dashboard/email-log"]) {
    // A real 403 from src/proxy.ts before any page renders (KNOWN_ISSUES N-07).
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  }
  const adminContext = await context.browser()!.newContext({ baseURL: "http://127.0.0.1:3100" });
  const admin = await adminContext.newPage();
  await login(admin, "admin");
  for (const [path, title] of [["/dashboard/staff", "Staff"], ["/dashboard/hosts", "Hosts"], ["/dashboard/settings/purposes", "Purpose options"], ["/dashboard/email-log", "Email log"]]) {
    await admin.goto(path); await expect(admin.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await adminContext.close();
});

test("stale cleanup closes the seeded visit at the configured site-day boundary", async ({ request }) => {
  // Reset only this isolated fixture because preceding dashboard reads also sweep stale visits.
  await db.visitEvent.deleteMany({ where: { visitId: "e2e-stale-visit", eventType: "AUTO_CLOSE" } });
  await db.visit.update({ where: { id: "e2e-stale-visit" }, data: { status: "ACTIVE", checkOutTime: null, closedAutomatically: false } });
  expect((await db.visit.findUniqueOrThrow({ where: { id: "e2e-stale-visit" } })).status).toBe("ACTIVE");
  const response = await request.post("/api/cron/close-stale-visits", { headers: { Authorization: "Bearer e2e-only-cron-secret" } });
  expect(response.status()).toBe(200);
  expect((await response.json()).closed).toBeGreaterThanOrEqual(1);
  const visit = await db.visit.findUniqueOrThrow({ where: { id: "e2e-stale-visit" }, include: { events: true } });
  const closing = new Date(zonedTimeToUtc(dateKeyInZone(visit.checkInTime), AUTO_CLOSE_TIME).getTime() + 59_999);
  expect(visit.status).toBe("CHECKED_OUT"); expect(visit.closedAutomatically).toBe(true);
  expect(visit.checkOutTime).toEqual(closing);
  expect(visit.events.filter(event => event.eventType === "AUTO_CLOSE")).toHaveLength(1);
});

test("health, safe API errors, heartbeat validation and persistent rate limits", async ({ request }) => {
  const health = await request.get("/api/health"); expect(health.status()).toBe(200);
  expect(Object.keys(await health.json()).sort()).toEqual(["db", "status", "time"]);
  const invalid = await request.post("/api/kiosk/heartbeat", { data: { deviceId: "invalid" } });
  expect(invalid.status()).toBe(400); const body = await invalid.json();
  expect(Object.keys(body.error).sort()).toEqual(["code", "message", "requestId"]); expect(JSON.stringify(body)).not.toContain("stack");
  const large = await request.post("/api/kiosk/heartbeat", { data: { deviceId: "x".repeat(500) } }); expect(large.status()).toBe(413);
  for (let i = 0; i < 21; i++) {
    const result = await request.post("/api/booking/lookup", { headers: { "x-forwarded-for": "192.0.2.99" }, data: {} });
    expect(result.status()).toBe(i === 20 ? 429 : 400);
  }
  for (let i = 0; i < 21; i++) {
    const result = await request.post("/api/appointments", { headers: { "x-forwarded-for": "192.0.2.100" }, data: {} });
    expect(result.status()).toBe(i === 20 ? 429 : 400);
  }
  const now = new Date();
  const day = bookableRange(now).first;
  for (let i = 0; i < 6; i++) {
    // A different client address each time: the per-email limit still applies.
    const result = await request.post("/api/appointments", { headers: { "x-forwarded-for": `192.0.2.${110 + i}` }, data: { firstName: "Limit", lastName: "Test", visitorEmail: "limit@e2e.invalid", hostId: "not-a-host", purposeId: "e2e-purpose", scheduledFor: toSlotValue(day, availableSlots(day, now)[0]), consent: true } });
    expect(result.status()).toBe(i === 5 ? 429 : 400);
    if (i === 5) expect((await result.json()).error.message).toContain("Too many bookings for this email");
  }
});

test("rotating client-supplied X-Forwarded-For does not escape rate limits (M-01)", async ({ request }) => {
  // Behind one trusted proxy the client is the rightmost entry; everything to
  // its left was written by the client and must not change the key.
  const statuses: number[] = [];
  for (let i = 0; i < 32; i++) {
    const result = await request.post("/api/appointments/validate", { headers: { "x-forwarded-for": `198.51.100.${i}, 192.0.2.150` }, data: { token: "11111111-1111-4111-8111-00000000000" + (i % 10) } });
    statuses.push(result.status());
  }
  expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  expect(statuses.slice(0, 30).every((status) => status !== 429)).toBe(true);
});

test("address-independent limits: per reference on the kiosk, per email for codes, per device for heartbeats", async ({ request }) => {
  const from = (i: number) => ({ "x-forwarded-for": `192.0.2.${160 + i}` });
  const refStatuses: number[] = [];
  for (let i = 0; i < 11; i++) refStatuses.push((await request.post("/api/appointments/validate", { headers: from(i), data: { token: "APT-E2E001", lastName: `Guess${i}` } })).status());
  expect(refStatuses.slice(0, 10).every((status) => status === 404)).toBe(true);
  expect(refStatuses[10]).toBe(429);
  const codeStatuses: number[] = [];
  for (let i = 0; i < 6; i++) codeStatuses.push((await request.post("/api/booking/lookup", { headers: from(20 + i), data: { firstName: "Code", lastName: "Limit", email: "code-limit@e2e.invalid" } })).status());
  // Three codes per email per window (MAX_CODES_PER_WINDOW), whatever the address.
  expect(codeStatuses).toEqual([200, 200, 200, 429, 429, 429]);
  const deviceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const beats: number[] = [];
  for (let i = 0; i < 7; i++) beats.push((await request.post("/api/kiosk/heartbeat", { headers: from(40 + i), data: { deviceId } })).status());
  expect(beats).toEqual([200, 200, 200, 200, 200, 200, 429]);
  await db.kioskDevice.deleteMany({ where: { deviceId } });
});

test("kiosk chip turns red and warns guards when heartbeats stop", async ({ page, request }) => {
  const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect((await request.post("/api/kiosk/heartbeat", { data: { deviceId } })).status()).toBe(200);
  await login(page, "admin");
  const chip = page.getByRole("button", { name: /^Kiosks:/ });
  await db.kioskDevice.updateMany({ where: { retiredAt: null }, data: { lastSeenAt: new Date() } });
  await page.reload(); await expect(chip).toHaveText("Kiosks: Online");
  await db.kioskDevice.update({ where: { deviceId }, data: { lastSeenAt: new Date(Date.now() - 181_000) } });
  // Unknown browsers do not affect monitoring until an administrator approves them.
  await page.reload(); await expect(chip).toHaveText("Kiosks: Online");
  await chip.click();
  const unconfirmed = page.getByRole("region", { name: "Unconfirmed devices" });
  await expect(unconfirmed).toBeVisible();
  const pendingDevice = await db.kioskDevice.findUniqueOrThrow({ where: { deviceId } });
  const pendingRow = unconfirmed.locator("div").filter({ hasText: pendingDevice.id });
  await pendingRow.getByRole("button", { name: "Approve", exact: true }).click();
  await page.reload(); await expect(chip).toHaveText("Kiosks: Offline");
  await expect(page.getByRole("alert").filter({ hasText: "switch to manual entry" })).toBeVisible();
  const device = await db.kioskDevice.findUniqueOrThrow({ where: { deviceId } });
  expect((await page.request.patch("/api/kiosks", { data: { id: device.id, label: "Front desk test" } })).status()).toBe(200);
  await page.reload(); await chip.click();
  const deviceRow = page.locator('section[aria-label="Kiosk devices"] > div').filter({ hasText: "Front desk test" });
  await deviceRow.getByRole("textbox").fill("Lobby test");
  await deviceRow.getByRole("button", { name: "Rename" }).click();
  await expect(deviceRow).toHaveCount(0);
  const renamed = page.locator('section[aria-label="Kiosk devices"] > div').filter({ hasText: "Lobby test" });
  page.once("dialog", dialog => dialog.accept());
  await renamed.getByRole("button", { name: "Retire" }).click();
  await expect(renamed).toContainText("Retired");
  await expect(chip).toHaveText("Kiosks: Online");
  await request.post("/api/kiosk/heartbeat", { data: { deviceId } });
  expect((await db.kioskDevice.findUniqueOrThrow({ where: { deviceId } })).retiredAt).not.toBeNull();

  const mail = await db.emailOutbox.create({ data: { to: "retry@e2e.invalid", subject: "Test retry", html: "<p>Test</p>", text: "Test", kind: "retry-test", status: "FAILED", attempts: 6, lastError: "Email delivery failed" } });
  await page.goto("/dashboard/email-log");
  await page.getByLabel("Status", { exact: true }).selectOption("FAILED");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const mailRow = page.getByRole("row").filter({ hasText: "retry@e2e.invalid" });
  await expect(mailRow).toContainText("Email delivery failed");
  await mailRow.getByRole("button", { name: "Retry now" }).click();
  await expect.poll(async () => (await db.emailOutbox.findUniqueOrThrow({ where: { id: mail.id } })).status).toBe("SENT");
});
