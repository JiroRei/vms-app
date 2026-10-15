import "server-only";
import { prisma } from "@/lib/prisma";

export const MAX_PENDING_KIOSKS = 20;
export const PENDING_KIOSK_RETENTION_MS = 7 * 24 * 3600_000;

export async function prunePendingKiosks(now = new Date()) {
  await prisma.kioskDevice.deleteMany({ where: { registrationStatus: "PENDING", lastSeenAt: { lt: new Date(now.getTime() - PENDING_KIOSK_RETENTION_MS) } } });
}

/** Serializes first registration across instances so concurrent requests cannot exceed the cap. */
export async function registerKioskHeartbeat(deviceId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71624003)`;
    await tx.kioskDevice.deleteMany({ where: { registrationStatus: "PENDING", lastSeenAt: { lt: new Date(now.getTime() - PENDING_KIOSK_RETENTION_MS) } } });
    const existing = await tx.kioskDevice.findUnique({ where: { deviceId } });
    if (existing) {
      // Retirement/dismissal survives later heartbeats.
      if (!existing.retiredAt) await tx.kioskDevice.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
      return true;
    }
    if (await tx.kioskDevice.count({ where: { registrationStatus: "PENDING" } }) >= MAX_PENDING_KIOSKS) return false;
    await tx.kioskDevice.create({ data: { deviceId, lastSeenAt: now, registrationStatus: "PENDING" } });
    return true;
  }, { timeout: 10_000 });
}
