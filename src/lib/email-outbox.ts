import "server-only";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { EmailOutbox, Prisma } from "@/generated/prisma/client";
import { nextEmailAttempt } from "@/lib/email-retry";
import { logger, reportError } from "@/lib/logger";

type Attachment = { filename: string; content: string | Buffer; contentType?: string; contentId?: string };
export type EmailMessage = { to: string; subject: string; html: string; text: string; attachments?: Attachment[]; kind: string; expiresAt?: Date | null };
export type EmailTransport = (message: EmailOutbox) => Promise<void>;
async function transport(message: EmailOutbox): Promise<void> {
  if (process.env.EMAIL_MODE === "test") return;
  if (!process.env.RESEND_API_KEY || !process.env.APPOINTMENT_FROM_EMAIL) throw new Error("Email transport unavailable");
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.APPOINTMENT_FROM_EMAIL, to: message.to, subject: message.subject, html: message.html, text: message.text,
    attachments: message.attachments as Attachment[],
  }, { idempotencyKey: message.id });
  if (error) throw new Error("Email provider rejected delivery");
}
async function deliver(row: EmailOutbox, now: Date, send: EmailTransport): Promise<boolean> {
  if (row.expiresAt && row.expiresAt <= now) {
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: "FAILED", lastError: "Expired before delivery", lockedUntil: null } });
    return false;
  }
  const attempts = row.attempts + 1;
  try {
    await send(row);
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: "SENT", attempts, sentAt: now, lastError: null, lockedUntil: null } });
    logger.info("Email delivered", { outboxId: row.id, kind: row.kind, recipient: row.to });
    return true;
  } catch {
    const nextAttemptAt = nextEmailAttempt(attempts, now);
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { attempts, status: nextAttemptAt ? "PENDING" : "FAILED", nextAttemptAt: nextAttemptAt ?? now, lastError: "Email delivery failed", lockedUntil: null } });
    logger.warn("Email delivery failed", { outboxId: row.id, attempts });
    return false;
  }
}
/** Persist before sending so a process crash cannot lose the message. Call from after() in requests. */
export async function sendEmail(message: EmailMessage, send: EmailTransport = transport): Promise<{ sent: true } | { sent: false; reason: "failed" }> {
  try {
    const attachments = (message.attachments ?? []).map((item) => ({ ...item, content: Buffer.isBuffer(item.content) ? item.content.toString("base64") : item.content }));
    if (Buffer.byteLength(JSON.stringify(attachments)) > 256_000) throw new Error("Attachments too large");
    const now = new Date();
    const row = await prisma.emailOutbox.create({ data: { ...message, id: randomUUID(), attachments: attachments as Prisma.InputJsonValue, lockedUntil: new Date(now.getTime() + 300_000) } });
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
const globalState = globalThis as typeof globalThis & { emailSweepAt?: number };
export async function sweepEmailOutboxIfDue(): Promise<void> {
  const now = Date.now();
  if (now - (globalState.emailSweepAt ?? 0) < 60_000) return;
  globalState.emailSweepAt = now;
  try { await processEmailOutbox(); } catch (error) { await reportError(error, { operation: "emailSweep" }); }
}
