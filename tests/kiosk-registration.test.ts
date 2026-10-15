import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { prisma } from "@/lib/prisma";
import { registerKioskHeartbeat, prunePendingKiosks, PENDING_KIOSK_RETENTION_MS } from "@/lib/kiosk-registration";
import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

test("concurrent registration caps pending devices at 20 and keeps unknown devices pending", async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => registerKioskHeartbeat(randomUUID())));
  assert.equal(results.filter(Boolean).length, 20);
  assert.equal(await prisma.kioskDevice.count({ where: { registrationStatus: "PENDING" } }), 20);
  assert.equal(await prisma.kioskDevice.count({ where: { registrationStatus: "APPROVED" } }), 0);
});

test("seven-day pruning preserves approved devices and fresh pending devices", async () => {
  const now = new Date();
  const old = new Date(now.getTime() - PENDING_KIOSK_RETENTION_MS - 1);
  await prisma.kioskDevice.createMany({ data: [
    { deviceId: randomUUID(), lastSeenAt: old },
    { deviceId: randomUUID(), lastSeenAt: old, registrationStatus: "APPROVED" },
    { deviceId: randomUUID(), lastSeenAt: new Date(now.getTime() - PENDING_KIOSK_RETENTION_MS) },
  ] });
  await prunePendingKiosks(now);
  assert.equal(await prisma.kioskDevice.count(), 2);
});

test("dismissed devices stay retired and free space in the pending queue", async () => {
  const deviceId = randomUUID();
  await registerKioskHeartbeat(deviceId);
  await prisma.kioskDevice.update({ where: { deviceId }, data: { registrationStatus: "RETIRED", retiredAt: new Date() } });
  await registerKioskHeartbeat(deviceId);
  const device = await prisma.kioskDevice.findUniqueOrThrow({ where: { deviceId } });
  assert.equal(device.registrationStatus, "RETIRED");
  assert.ok(device.retiredAt);
  assert.equal(await prisma.kioskDevice.count({ where: { registrationStatus: "PENDING" } }), 0);
});
