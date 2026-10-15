import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "./helpers";
import { sendVisitorPassEmail, sendVerificationCodeEmail } from "@/lib/email";
import { signPassToken } from "@/lib/pass-token";
beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });
test("pass emails retain inline QR images without printing tokens", async () => {
  const token = signPassToken({ passId: "testpass00000001", version: 1, secret: "test-secret-for-pass-email-0123456789" });
  const output: string[] = [];
  const capture = mock.method(console, "log", (message: string) => { output.push(message); });
  try {
    for (const kind of ["issued", "replaced"] as const) assert.deepEqual(await sendVisitorPassEmail({ firstName: "Test", visitorEmail: "pass@example.invalid", token, expiresAt: new Date("2027-10-12T00:00:00Z"), kind }), { sent: true });
    const rows = await prisma.emailOutbox.findMany();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.status === "SENT" && Array.isArray(row.attachments) && row.attachments.length === 1));
    assert.ok(output.every(line => !line.includes(token) && !line.includes("pass@example.invalid")));
  } finally { capture.mock.restore(); }
});
test("verification expiration belongs to code issuance, not delayed send time", async () => {
  const expiresAt = new Date(Date.now() - 1000);
  await sendVerificationCodeEmail({ firstName: "Test", visitorEmail: "test@example.invalid", code: "123456", validMinutes: 10, expiresAt });
  const row = await prisma.emailOutbox.findFirstOrThrow();
  assert.equal(row.status, "FAILED"); assert.equal(row.lastError, "Expired before delivery"); assert.equal(row.attempts, 0);
});
