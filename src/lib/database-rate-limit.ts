import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { RateLimitResult, RateLimitRule } from "@/lib/rate-limit";

/** Atomic fixed windows shared across server instances. Keys retain no email/IP. */
export async function consumeDatabaseRateLimit(identity: string, rule: RateLimitRule, now = new Date()): Promise<RateLimitResult> {
  const windowMs = rule.window * 1000;
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const expiresAt = new Date(start + windowMs);
  const key = createHash("sha256").update(`${identity}:${start}`).digest("hex");
  const bucket = await prisma.rateLimitBucket.upsert({ where: { key }, create: { key, expiresAt }, update: { count: { increment: 1 } }, select: { count: true } });
  return { allowed: bucket.count <= rule.max, retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)) };
}
const state = globalThis as typeof globalThis & { rateLimitPrunedAt?: number };
export async function pruneRateLimits(): Promise<void> {
  if (Date.now() - (state.rateLimitPrunedAt ?? 0) < 3600_000) return;
  state.rateLimitPrunedAt = Date.now();
  await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
