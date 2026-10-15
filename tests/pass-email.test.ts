/**
 * The email outbox keeps no secrets once it no longer needs them
 * (KNOWN_ISSUES M-05): bodies are cleared after sending, failing for good or
 * expiring; pass emails never store their QR; old rows are purged; and codes,
 * tokens and links never reach the logs.
 */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "./helpers";
import { sendPasswordResetEmail, sendVisitorPassEmail, sendVerificationCodeEmail } from "@/lib/email";
import { processEmailOutbox, purgeEmailOutbox, sendEmail, type OutgoingEmail } from "@/lib/email-outbox";
import { EMAIL_BACKOFF_MS } from "@/lib/email-retry";
import { makeNameKey } from "@/lib/names";
import { tokenForPass } from "@/lib/visitor-pass";
import { sanitize } from "@/lib/logger";
beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

const DAY = 86_400_000;
const message = { to: "test@example.invalid", subject: "Test", html: "<p>secret-body</p>", text: "secret-body", kind: "test" };

async function makePass() {
  const profile = await prisma.visitorProfile.create({ data: { firstName: "Test", lastName: "Holder", nameKey: makeNameKey("Test", "Holder"), email: "pass@example.invalid" } });
  return prisma.visitorPass.create({ data: { profileId: profile.id, issueReason: "RECURRING_AUTO", expiresAt: new Date(Date.now() + 30 * DAY) } });
}

/** Everything written to the console while `run` executes. */
async function captureLogs(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const spies = (["log", "warn", "error", "info"] as const).map((name) => mock.method(console, name, (...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
  try { await run(); } finally { for (const spy of spies) spy.mock.restore(); }
  return lines.join("\n");
}

function assertCleared(row: { html: string; text: string; attachments: unknown; bodyClearedAt: Date | null }) {
  assert.equal(row.html, ""); assert.equal(row.text, ""); assert.deepEqual(row.attachments, []);
  assert.ok(row.bodyClearedAt, "bodyClearedAt is set");
}

test("a sent message keeps only metadata", async () => {
  const delivered: OutgoingEmail[] = [];
  assert.deepEqual(await sendEmail({ ...message, attachments: [{ filename: "qr.png", content: Buffer.from("image"), contentId: "qr" }] }, async (email) => { delivered.push(email); }), { sent: true });
  assert.equal(delivered[0].html, message.html, "the provider still receives the full message");
  assert.deepEqual(delivered[0].attachments, [{ filename: "qr.png", content: "aW1hZ2U=", contentId: "qr" }]);
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.status, "SENT"); assert.equal(row.to, message.to); assert.equal(row.kind, "test"); assert.ok(row.sentAt && row.createdAt);
  assertCleared(row);
});

test("a message that fails for good is cleared; one still retrying is not", async () => {
  const fail = async () => { throw new Error("failure"); };
  await sendEmail(message, fail);
  let row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.status, "PENDING"); assert.equal(row.html, message.html); assert.equal(row.bodyClearedAt, null);
  for (let i = 0; i < EMAIL_BACKOFF_MS.length; i++) {
    await processEmailOutbox(row.nextAttemptAt, fail);
    row = await prisma.emailOutbox.findFirstOrThrow();
  }
  assert.equal(row.status, "FAILED");
  assertCleared(row);
});

test("an expired message is cleared without sending", async () => {
  await sendVerificationCodeEmail({ firstName: "Test", visitorEmail: "test@example.invalid", code: "123456", validMinutes: 10, expiresAt: new Date(Date.now() - 1000) });
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.status, "FAILED"); assert.equal(row.lastError, "Expired before delivery");
  assertCleared(row);
  assert.ok(!row.subject.includes("123456"), "the code is not in the subject (N-10)");
});

test("pass emails store the pass id, never the QR, and render it at send time", async () => {
  const pass = await makePass();
  const token = tokenForPass(pass);
  // Queue it without sending (as during a provider outage) to look at the stored row.
  await sendVisitorPassEmail({ firstName: "Test", visitorEmail: "pass@example.invalid", pass, expiresAt: pass.expiresAt, kind: "issued" });
  const sent = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(sent.status, "SENT"); assert.equal(sent.passId, pass.id); assert.equal(sent.passVersion, 1);
  assertCleared(sent);
  await prisma.emailOutbox.deleteMany();

  const delivered: OutgoingEmail[] = [];
  await sendEmail({ ...message, kind: "visitor-pass-issued", pass }, async () => { throw new Error("outage"); });
  const queued = await prisma.emailOutbox.findFirstOrThrow();
  assert.deepEqual(queued.attachments, [], "no QR image in the table while queued");
  assert.ok(!JSON.stringify(queued).includes(token), "no pass token in the row");
  await processEmailOutbox(queued.nextAttemptAt, async (email) => { delivered.push(email); });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].attachments.length, 1);
  assert.equal(delivered[0].attachments[0].contentId, "visitor-pass-qr");
});

test("a pass email is dropped if the pass was rotated or revoked before sending", async () => {
  const pass = await makePass();
  await sendEmail({ ...message, kind: "visitor-pass-issued", pass }, async () => { throw new Error("outage"); });
  await prisma.visitorPass.update({ where: { id: pass.id }, data: { version: 2 } });
  const queued = await prisma.emailOutbox.findFirstOrThrow();
  let calls = 0;
  await processEmailOutbox(queued.nextAttemptAt, async () => { calls++; });
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(calls, 0); assert.equal(row.status, "FAILED"); assert.equal(row.lastError, "Pass no longer active");
  assertCleared(row);
});

test("retention purges old rows: 14 days, 30 for failed", async () => {
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() - days * DAY);
  await prisma.emailOutbox.createMany({ data: [
    { ...message, id: "sent-15d", status: "SENT", createdAt: at(15) },
    { ...message, id: "sent-13d", status: "SENT", createdAt: at(13) },
    { ...message, id: "failed-20d", status: "FAILED", createdAt: at(20) },
    { ...message, id: "failed-31d", status: "FAILED", createdAt: at(31) },
    { ...message, id: "pending-expired", status: "PENDING", createdAt: at(1), expiresAt: at(0.5) },
  ] });
  assert.deepEqual(await purgeEmailOutbox(now), { expired: 1, deleted: 2 });
  const left = await prisma.emailOutbox.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(left.map((row) => row.id), ["failed-20d", "pending-expired", "sent-13d"]);
  const expired = left.find((row) => row.id === "pending-expired")!;
  assert.equal(expired.status, "FAILED"); assertCleared(expired);
});

test("codes, tokens, reset links and QR data never reach the logs", async () => {
  const pass = await makePass();
  const token = tokenForPass(pass);
  const resetUrl = "http://localhost:3000/reset-password?token=reset-token-0123456789abcdef";
  const output = await captureLogs(async () => {
    await sendVerificationCodeEmail({ firstName: "Test", visitorEmail: "code@example.invalid", code: "654321", validMinutes: 10 });
    await sendPasswordResetEmail({ email: "staff@example.invalid", name: "Staff", url: resetUrl });
    await sendVisitorPassEmail({ firstName: "Test", visitorEmail: "pass@example.invalid", pass, expiresAt: pass.expiresAt, kind: "issued" });
    // A provider failure is logged too.
    await sendEmail({ ...message, text: `code 112233 ${resetUrl} ${token}` }, async () => { throw new Error(`provider said ${resetUrl}`); });
  });
  assert.ok(output.includes("Email delivered"), "the log ran");
  for (const secret of ["654321", "112233", "reset-token-0123456789abcdef", token, "data:image/png", "code@example.invalid", "pass@example.invalid"]) {
    assert.ok(!output.includes(secret), `log output contains ${secret}`);
  }
});

test("the log sanitizer redacts secrets inside free text", () => {
  const line = String(sanitize("reset http://x.invalid/reset-password?token=abc.def&x=1 manage /appointment-booking/manage?token=t0k3n code 123456 pass vp1.abc.def Bearer s3cr3t data:image/png;base64,iVBORw0KGgo= by a@b.invalid"));
  for (const secret of ["abc.def", "t0k3n", "123456", "vp1.abc", "s3cr3t", "iVBORw0KGgo", "a@b.invalid"]) assert.ok(!line.includes(secret), `still contains ${secret}: ${line}`);
  assert.ok(line.includes("&x=1"), "non-secret parameters survive");
});
