import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "./helpers";
import { sendEmail, processEmailOutbox } from "@/lib/email-outbox";
import { EMAIL_BACKOFF_MS, nextEmailAttempt } from "@/lib/email-retry";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";
import { makeNameKey } from "@/lib/names";
import { checkSlot, zonedTimeToUtc, dateKeyInZone, PUBLIC_BOOKING_EMAIL_LIMIT, PUBLIC_BOOKING_IP_LIMIT, VERIFICATION_IP_LIMIT } from "@/lib/booking-config";
import { kioskStatus } from "@/lib/kiosks";
import { isolatedTestUrl } from "./test-database";
import { sanitize } from "@/lib/logger";
beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });
const message = { to: "test@example.invalid", subject: "Test", html: "<p>Test</p>", text: "Test", kind: "test" };
test("outbox follows every backoff and stops after five retries", async () => {
  const fail = async () => { throw new Error("private-provider-details"); };
  await sendEmail(message, fail);
  let row = await prisma.emailOutbox.findFirstOrThrow();
  for (let i = 0; i < EMAIL_BACKOFF_MS.length; i++) {
    assert.equal(row.attempts, i + 1); assert.equal(row.status, "PENDING");
    const due = row.nextAttemptAt;
    await processEmailOutbox(due, fail);
    row = await prisma.emailOutbox.findFirstOrThrow();
    if (i + 1 < EMAIL_BACKOFF_MS.length) assert.equal(row.nextAttemptAt.getTime() - due.getTime(), EMAIL_BACKOFF_MS[i + 1]);
  }
  assert.equal(row.status, "FAILED"); assert.equal(row.attempts, 6);
  assert.equal(nextEmailAttempt(6, new Date()), null);
});
test("forced delivery failure retries and eventually sends", async () => {
  await sendEmail(message, async () => { throw new Error("failure"); });
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.attempts, 1);
  const sent: string[] = [];
  await Promise.all([processEmailOutbox(row.nextAttemptAt, async (email) => { sent.push(email.id); }), processEmailOutbox(row.nextAttemptAt, async (email) => { sent.push(email.id); })]);
  assert.equal(sent.length, 1);
  const result = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(result.status, "SENT"); assert.equal(result.attempts, 2);
});
test("expired verification is dropped without sending", async () => {
  const row = await prisma.emailOutbox.create({ data: { ...message, kind: "verification", expiresAt: new Date(0) } });
  let calls = 0;
  await processEmailOutbox(new Date(), async () => { calls++; });
  assert.equal(calls, 0); assert.equal((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).lastError, "Expired before delivery");
});
test("concurrent failed sweeps cannot bypass the newly scheduled backoff", async () => {
  const fail = async () => { throw new Error("failure"); };
  await sendEmail(message, fail);
  const row = await prisma.emailOutbox.findFirstOrThrow();
  await Promise.all([processEmailOutbox(row.nextAttemptAt, fail), processEmailOutbox(row.nextAttemptAt, fail)]);
  const retried = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(retried.attempts, 2);
  assert.equal(retried.nextAttemptAt.getTime() - row.nextAttemptAt.getTime(), 300_000);
});
test("EMAIL_MODE=test records SENT with base64 inline attachments", async () => {
  assert.equal(process.env.EMAIL_MODE, "test");
  await sendEmail({ ...message, attachments: [{ filename: "qr.png", content: Buffer.from("image"), contentId: "qr" }] });
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.status, "SENT"); assert.deepEqual(row.attachments, [{ filename: "qr.png", content: "aW1hZ2U=", contentId: "qr" }]);
});
test("database limits enforce exact booking and verification caps under concurrency", async () => {
  for (const [key, rule] of [["email", PUBLIC_BOOKING_EMAIL_LIMIT], ["ip", PUBLIC_BOOKING_IP_LIMIT], ["verification", VERIFICATION_IP_LIMIT]] as const) {
    const results = await Promise.all(Array.from({ length: rule.max + 3 }, () => consumeDatabaseRateLimit(key, rule, new Date("2026-10-01T10:00:00Z"))));
    assert.equal(results.filter(result => result.allowed).length, rule.max);
  }
});
test("slot validation rejects impossible dates, invalid boundaries and past slots", () => {
  const now = zonedTimeToUtc("2026-10-13", "08:00");
  for (const value of ["2026-02-31T09:00", "2026-10-13T08:15", "2026-10-13T17:00", "2026-10-13T08:00", "2026-11-14T09:00", "2026-10-13T09:00Tgarbage"]) assert.equal(checkSlot(value, now).ok, false, value);
  assert.equal(checkSlot("2026-10-13T08:30", now).ok, true);
  assert.equal(dateKeyInZone(zonedTimeToUtc("2026-10-13", "00:00")), "2026-10-13");
});
test("name keys normalize accents, case and whitespace while keeping part boundaries", () => {
  assert.equal(makeNameKey("  José  María ", " GARCÍA "), makeNameKey("jose maria", "garcia"));
  assert.notEqual(makeNameKey("Ann Marie", "Smith"), makeNameKey("Ann", "Marie Smith"));
});
test("kiosk turns offline at 90 seconds and retired devices stay retired", () => {
  assert.equal(kioskStatus(new Date(0), null, 90_000), "Online");
  assert.equal(kioskStatus(new Date(0), null, 90_001), "Offline");
  assert.equal(kioskStatus(new Date(0), new Date(1), 900_000), "Retired");
});
test("isolation refuses development target even with different credentials or URL options", () => {
  const dev = "postgresql://a:b@localhost/vms";
  assert.throws(() => isolatedTestUrl(dev, dev));
  assert.throws(() => isolatedTestUrl("postgresql://a:b@localhost/vms?schema=e2e", "postgresql://c:d@localhost:5432/vms?schema=e2e&sslmode=require"));
  assert.equal(new URL(isolatedTestUrl(dev, undefined)).searchParams.get("schema"), "e2e");
});
test("logs mask recipients and redact codes, credentials and error messages", () => {
  const result = JSON.stringify(sanitize({ email: "test@example.invalid", code: "123456", token: "private", secret: "private", error: new Error("password leak") }));
  assert.ok(!result.includes("test@")); assert.ok(!result.includes("123456")); assert.ok(!result.includes("private")); assert.ok(!result.includes("password leak"));
});
