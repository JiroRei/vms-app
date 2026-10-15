/**
 * Kiosk self-service lookups (KNOWN_ISSUES M-01): a reference number needs the
 * booking's last name, and the per-code and global limits hold whatever
 * address the requests come from.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { prisma } from "@/lib/prisma";
import { redeemAppointment } from "@/lib/appointments";
import { KIOSK_REFERENCE_LIMIT, KIOSK_VALIDATION_GLOBAL_LIMIT } from "@/lib/booking-config";
import { consumeKioskCodeLimits } from "@/lib/kiosk-limits";
import { sameLastName } from "@/lib/names";
import { validateAppointmentToken } from "@/lib/qr";
import { makeAppointment, makeHost, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

test("last names compare like name keys, and empty never matches", () => {
  assert.equal(sameLastName("  garcía ", "Garcia"), true);
  assert.equal(sameLastName("Garcia", "Garcias"), false);
  assert.equal(sameLastName("", ""), false);
});

test("on the kiosk a reference number needs the last name; the QR token does not", async () => {
  const appointment = await makeAppointment((await makeHost()).id);
  const lastName = appointment.lastName;
  assert.equal((await validateAppointmentToken(appointment.referenceNumber, { lastName: "Nobody" })).ok, false);
  const wrong = await validateAppointmentToken(appointment.referenceNumber, { lastName: "Nobody" });
  assert.equal(!wrong.ok && wrong.reason, "NOT_FOUND", "a wrong name looks exactly like an unknown code");
  assert.equal((await validateAppointmentToken(appointment.referenceNumber, { lastName })).ok, true);
  assert.equal((await validateAppointmentToken(appointment.qrToken, { lastName: "" })).ok, true);
  assert.equal((await validateAppointmentToken(appointment.referenceNumber)).ok, true, "guards look up by reference alone");
  const refused = await redeemAppointment(appointment.referenceNumber, { holder: { lastName: "Nobody" } });
  assert.equal(refused.status, "failed");
  assert.equal((await redeemAppointment(appointment.referenceNumber, { holder: { lastName } })).status, "checked-in");
});

test("per-code limit, then a global ceiling across all codes", async () => {
  for (let i = 0; i < KIOSK_REFERENCE_LIMIT.max; i++) assert.equal(await consumeKioskCodeLimits("APT-AAAAAA"), null);
  assert.equal((await consumeKioskCodeLimits("APT-AAAAAA"))?.status, 429);
  await prisma.rateLimitBucket.deleteMany();
  for (let i = 0; i < KIOSK_VALIDATION_GLOBAL_LIMIT.max; i++) assert.equal(await consumeKioskCodeLimits(`APT-${String(i).padStart(6, "0")}`), null);
  const ceiling = await consumeKioskCodeLimits("APT-ZZZZZZ");
  assert.equal(ceiling?.status, 429);
  assert.ok(Number(ceiling?.headers.get("Retry-After")) > 0);
});
