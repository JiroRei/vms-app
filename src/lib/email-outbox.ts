import "server-only";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import type { EmailOutbox, Prisma } from "@/generated/prisma/client";
import { nextEmailAttempt } from "@/lib/email-retry";
import { logger, reportError } from "@/lib/logger";
import { renderPassQrPng } from "@/lib/pass-token";
import { tokenForPass } from "@/lib/visitor-pass";

/**
 * The outbox: every email is written here before it is sent, so a crash or a
 * provider outage cannot lose it, and failed sends are retried with backoff.
 *
 * Bodies are sensitive (one-time codes, password-reset links, signed manage
 * links), so a row keeps its `html`, `text` and `attachments` only while it can
 * still be sent (KNOWN_ISSUES M-05):
 *
 * - SENT, finally FAILED or expired: the body is emptied at once and
 *   `bodyClearedAt` set. Recipient, kind, status and timestamps stay for the
 *   email log.
 * - Visitor-pass emails never store the QR: they store `passId`/`passVersion`
 *   and the image is rendered at send time, only if that pass is still active
 *   at that version.
 * - Rows are deleted 14 days after creation (30 when FAILED), by the request
 *   sweep and the `/api/cron/process-email-outbox` job.
 */

type Attachment = { filename: string; content: string | Buffer; contentType?: string; contentId?: string };
export type EmailMessage = { to: string; subject: string; html: string; text: string; attachments?: Attachment[]; kind: string; expiresAt?: Date | null; pass?: { id: string; version: number } };
/** A row ready to hand to the provider, with any send-time attachments rendered. */
export type OutgoingEmail = Omit<EmailOutbox, "attachments"> & { attachments: Attachment[] };
export type EmailTransport = (message: OutgoingEmail) => Promise<void>;

export const EMAIL_RETENTION_DAYS = 14;
export const FAILED_EMAIL_RETENTION_DAYS = 30;
export const PASS_QR_CONTENT_ID = "visitor-pass-qr";
const DAY_MS = 86_400_000;
/** What a row looks like once its body is no longer needed. */
const CLEARED_BODY = { html: "", text: "", attachments: [] as Prisma.InputJsonValue[] };

async function transport(message: OutgoingEmail): Promise<void> {
  if (process.env.EMAIL_MODE === "test") {
    // End-to-end tests read what was "sent" (a booking code, say) from this
    // file, now that the outbox keeps no bodies. Test mode only; never set in
    // a real deployment.
    if (process.env.EMAIL_TEST_SINK) appendFileSync(process.env.EMAIL_TEST_SINK, JSON.stringify({ to: message.to, kind: message.kind, subject: message.subject, text: message.text }) + "\n");
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.APPOINTMENT_FROM_EMAIL) throw new Error("Email transport unavailable");
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.APPOINTMENT_FROM_EMAIL, to: message.to, subject: message.subject, html: message.html, text: message.text,
    attachments: message.attachments,
  }, { idempotencyKey: message.id });
  if (error) throw new Error("Email provider rejected delivery");
}

/** Ends a message for good: final status, no body. */
function finish(id: string, now: Date, data: Prisma.EmailOutboxUpdateInput) {
  return prisma.emailOutbox.update({ where: { id }, data: { ...data, ...CLEARED_BODY, bodyClearedAt: now, lockedUntil: null } });
}

/**
 * The attachments to send. For a pass email, the QR of the pass as it is now,
 * or null when the pass was revoked, rotated or has expired since the email
 * was queued (a newer email, or none, is the right outcome then).
 */
async function attachmentsFor(row: EmailOutbox, now: Date): Promise<Attachment[] | null> {
  if (!row.passId) return row.attachments as Attachment[];
  const pass = await prisma.visitorPass.findUnique({ where: { id: row.passId }, select: { id: true, version: true, status: true, expiresAt: true } });
  if (!pass || pass.status !== "ACTIVE" || pass.version !== row.passVersion || pass.expiresAt <= now) return null;
  return [{ filename: "visitor-pass.png", content: await renderPassQrPng(tokenForPass(pass)), contentType: "image/png", contentId: PASS_QR_CONTENT_ID }];
}

async function deliver(row: EmailOutbox, now: Date, send: EmailTransport): Promise<boolean> {
  if (row.expiresAt && row.expiresAt <= now) {
    await finish(row.id, now, { status: "FAILED", lastError: "Expired before delivery" });
    return false;
  }
  const attempts = row.attempts + 1;
  try {
    const attachments = await attachmentsFor(row, now);
    if (!attachments) {
      await finish(row.id, now, { status: "FAILED", lastError: "Pass no longer active" });
      return false;
    }
    await send({ ...row, attachments });
    await finish(row.id, now, { status: "SENT", attempts, sentAt: now, lastError: null });
    logger.info("Email delivered", { outboxId: row.id, kind: row.kind, recipient: row.to });
    return true;
  } catch {
    const nextAttemptAt = nextEmailAttempt(attempts, now);
    if (nextAttemptAt) {
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { attempts, status: "PENDING", nextAttemptAt, lastError: "Email delivery failed", lockedUntil: null } });
    } else {
      await finish(row.id, now, { attempts, status: "FAILED", nextAttemptAt: now, lastError: "Email delivery failed" });
    }
    logger.warn("Email delivery failed", { outboxId: row.id, attempts });
    return false;
  }
}

/** Persist before sending so a process crash cannot lose the message. Call from after() in requests. */
export async function sendEmail(message: EmailMessage, send: EmailTransport = transport): Promise<{ sent: true } | { sent: false; reason: "failed" }> {
  try {
    const { pass, attachments: input, ...fields } = message;
    const attachments = (input ?? []).map((item) => ({ ...item, content: Buffer.isBuffer(item.content) ? item.content.toString("base64") : item.content }));
    if (Buffer.byteLength(JSON.stringify(attachments)) > 256_000) throw new Error("Attachments too large");
    const now = new Date();
    const row = await prisma.emailOutbox.create({ data: { ...fields, id: randomUUID(), attachments: attachments as Prisma.InputJsonValue, passId: pass?.id ?? null, passVersion: pass?.version ?? null, lockedUntil: new Date(now.getTime() + 300_000) } });
    return await deliver(row, now, send) ? { sent: true } : { sent: false, reason: "failed" };
  } catch (error) { await reportError(error, { operation: "sendEmail" }); return { sent: false, reason: "failed" }; }
}
export async function processEmailOutbox(now = new Date(), send: EmailTransport = transport): Promise<{ processed: number }> {
  const rows = await prisma.emailOutbox.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { nextAttemptAt: "asc" }, take: 25 });
  let processed = 0;
  for (const row of rows) {
    const claimed = await prisma.emailOutbox.updateMany({ where: { id: row.id, status: "PENDING", attempts: row.attempts, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + 300_000) } });
    if (!claimed.count) continue;
    await deliver(row, now, send);
    processed++;
  }
  return { processed };
}

/**
 * Retention: drops expired bodies that nothing has picked up yet, then deletes
 * old rows. Safe to run at any frequency; both steps are idempotent.
 */
export async function purgeEmailOutbox(now = new Date()): Promise<{ expired: number; deleted: number }> {
  const expired = await prisma.emailOutbox.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "FAILED", lastError: "Expired before delivery", lockedUntil: null, ...CLEARED_BODY, bodyClearedAt: now } });
  const deleted = await prisma.emailOutbox.deleteMany({ where: { OR: [
    { status: { not: "FAILED" }, createdAt: { lt: new Date(now.getTime() - EMAIL_RETENTION_DAYS * DAY_MS) } },
    { status: "FAILED", createdAt: { lt: new Date(now.getTime() - FAILED_EMAIL_RETENTION_DAYS * DAY_MS) } },
  ] } });
  return { expired: expired.count, deleted: deleted.count };
}

const globalState = globalThis as typeof globalThis & { emailSweepAt?: number };
export async function sweepEmailOutboxIfDue(): Promise<void> {
  const now = Date.now();
  if (now - (globalState.emailSweepAt ?? 0) < 60_000) return;
  globalState.emailSweepAt = now;
  try { await processEmailOutbox(); await purgeEmailOutbox(); } catch (error) { await reportError(error, { operation: "emailSweep" }); }
}
export const EMAIL_LOG_PAGE_SIZE = 50;
/** Metadata only: the email log never needs, and so never reads, message bodies. */
export function listEmailLog({ status, page }: { status?: EmailOutbox["status"]; page: number }) {
  return prisma.emailOutbox.findMany({ where: { status }, select: { id: true, to: true, kind: true, status: true, attempts: true, lastError: true, expiresAt: true, createdAt: true, sentAt: true, bodyClearedAt: true }, orderBy: { createdAt: "desc" }, take: EMAIL_LOG_PAGE_SIZE, skip: (page - 1) * EMAIL_LOG_PAGE_SIZE });
}
