/** Appointment lifecycle, atomic redemption and retained history. */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import {
  cancelAppointment, createAppointment, getAppointmentByReference,
  listStaffAppointments, redeemAppointment, regenerateQrToken,
  rescheduleAppointment, AppointmentSlotUnavailableError, type CreateAppointmentInput,
} from "@/lib/appointments";
import { addDaysToKey, zonedTimeToUtc } from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { appointmentExpiry, classifyAppointment, validateAppointmentToken } from "@/lib/qr";
import { makeAppointment, makeHost, makePurpose, resetDatabase } from "./helpers";
import { createPurposeOption } from "@/lib/purposes";

beforeEach(resetDatabase);
after(async () => { await resetDatabase(); await prisma.$disconnect(); });

const actor = { type: "VISITOR" } as const;
const day = "2026-10-12";
const now = zonedTimeToUtc(day, "10:00");

async function bookingInput(hostId: string, overrides: Partial<CreateAppointmentInput> = {}): Promise<CreateAppointmentInput> {
  const purpose = await makePurpose();
  return {
    firstName: "Appointment", lastName: "Visitor", visitorEmail: "visitor@example.invalid",
    visitorPhone: null, hostId, purposeId: purpose.id,
    scheduledFor: new Date(Date.now() + Math.random() * 3_600_000), verified: null, consentAcceptedAt: new Date(), actor,
    ...overrides,
  };
}

describe("creating", () => {
  test("rejects another pending appointment for the same host and exact time", async () => {
    const host = await makeHost();
    const input = await bookingInput(host.id, { scheduledFor: zonedTimeToUtc(day, "14:00") });
    await createAppointment(input);
    await assert.rejects(
      createAppointment(input),
      AppointmentSlotUnavailableError,
    );
  });

  test("purpose labels are unique without case differences", async () => {
    await makePurpose("Meeting");
    assert.deepEqual(await createPurposeOption("meeting"), {
      ok: false,
      reason: "duplicate-label",
    });
  });

  test("generates unique references and logs creation with a linked profile", async () => {
    const host = await makeHost();
    const references = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const appointment = await createAppointment(await bookingInput(host.id, { firstName: "Visitor " + i }));
      assert.match(appointment.referenceNumber, /^APT-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      references.add(appointment.referenceNumber);
      assert.ok(appointment.visitorProfileId);
      assert.equal(appointment.status, "PENDING");
      assert.equal(await prisma.appointmentEvent.count({ where: { appointmentId: appointment.id, type: "CREATED" } }), 1);
    }
    assert.equal(references.size, 25);
  });

  test("a foreign-key failure rolls back the appointment, new profile and event", async () => {
    await assert.rejects(() => bookingInput("no-such-host").then(createAppointment));
    assert.equal(await prisma.appointment.count(), 0);
    assert.equal(await prisma.visitorProfile.count(), 0);
    assert.equal(await prisma.appointmentEvent.count(), 0);
  });

  test("keeps the scheduled instant and computes its grace-period expiry", async () => {
    const host = await makeHost();
    const when = zonedTimeToUtc(day, "11:30");
    const appointment = await createAppointment(await bookingInput(host.id, { scheduledFor: when }));
    assert.deepEqual(appointment.scheduledFor, when);
    assert.deepEqual(appointment.expiresAt, appointmentExpiry(when));
  });
});

describe("looking up and eligibility", () => {
  test("accepts a trimmed, case-insensitive reference and its QR token", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id, { referenceNumber: "APT-ABC123" });
    assert.equal((await getAppointmentByReference("  apt-abc123  "))?.id, appointment.id);
    assert.equal((await validateAppointmentToken("  apt-abc123  ")).ok, true);
    assert.equal((await validateAppointmentToken(appointment.qrToken)).ok, true);
  });

  test("distinguishes a redeemed appointment from a missing one", async () => {
    const host = await makeHost();
    await makeAppointment(host.id, { status: "CHECKED_IN" });
    const used = await validateAppointmentToken("APT-TEST01");
    const missing = await validateAppointmentToken("APT-NOPE99");
    assert.ok(!used.ok && used.reason === "ALREADY_USED");
    assert.ok(!missing.ok && missing.reason === "NOT_FOUND");
  });

  test("rejects cancelled, expired, wrong-day and too-early arrivals", () => {
    const scheduledFor = zonedTimeToUtc(day, "12:00");
    const appointment = { status: "PENDING" as const, scheduledFor, expiresAt: appointmentExpiry(scheduledFor) };
    assert.equal(classifyAppointment({ ...appointment, status: "CANCELLED" }, now), "CANCELLED");
    assert.equal(classifyAppointment({ ...appointment, expiresAt: now }, now), "EXPIRED");
    assert.equal(classifyAppointment({ ...appointment, scheduledFor: zonedTimeToUtc(addDaysToKey(day, 1), "09:00") }, now), "WRONG_DAY");
    assert.equal(classifyAppointment(appointment, now), "TOO_EARLY");
    assert.equal(classifyAppointment(appointment, zonedTimeToUtc(day, "11:00")), null);
  });
});

describe("redeeming", () => {
  test("retains the appointment and links one visit with both check-in events", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    const result = await redeemAppointment(appointment.referenceNumber);
    assert.equal(result.status, "checked-in");
    assert.ok(result.status === "checked-in");
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(row.status, "CHECKED_IN");
    assert.equal(row.visitId, result.visitId);
    const visit = await prisma.visit.findUniqueOrThrow({ where: { id: result.visitId } });
    assert.equal(visit.status, "ACTIVE");
    assert.equal(visit.checkInMethod, "APPOINTMENT");
    assert.equal(await prisma.visitEvent.count({ where: { visitId: visit.id, eventType: "CHECK_IN" } }), 1);
    assert.equal(await prisma.appointmentEvent.count({ where: { appointmentId: row.id, type: "CHECKED_IN" } }), 1);
  });

  test("two simultaneous redemptions create one visit and one appointment event", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    const results = await Promise.all([redeemAppointment(appointment.referenceNumber), redeemAppointment(appointment.qrToken)]);
    assert.equal(results.filter((result) => result.status === "checked-in").length, 1);
    assert.ok(results.some((result) => result.status === "failed" && result.reason === "ALREADY_USED"));
    assert.equal(await prisma.visit.count(), 1);
    assert.equal(await prisma.appointmentEvent.count({ where: { appointmentId: appointment.id, type: "CHECKED_IN" } }), 1);
  });

  test("guard assistance is attributed to the signed-in staff member", async () => {
    const host = await makeHost();
    const guard = await prisma.user.create({ data: { name: "Test guard", email: "guard@example.invalid" } });
    const appointment = await makeAppointment(host.id);
    const result = await redeemAppointment(appointment.qrToken, { checkedInBy: guard.id });
    assert.ok(result.status === "checked-in");
    assert.equal((await prisma.visit.findUniqueOrThrow({ where: { id: result.visitId } })).checkedInBy, guard.id);
    assert.equal((await prisma.appointmentEvent.findFirstOrThrow({ where: { appointmentId: appointment.id } })).actorUserId, guard.id);
  });
});

describe("cancelling", () => {
  test("retains a cancelled row, reason and event so its QR explains the cancellation", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    const result = await cancelAppointment(appointment.id, { actor, reason: "  Plans changed  " });
    assert.equal(result.status, "ok");
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(row.status, "CANCELLED");
    assert.equal(row.cancelledBy, "VISITOR");
    assert.equal(row.cancelReason, "Plans changed");
    assert.ok(row.cancelledAt);
    const lookup = await validateAppointmentToken(appointment.qrToken);
    assert.ok(!lookup.ok && lookup.reason === "CANCELLED");
    assert.equal(await prisma.appointmentEvent.count({ where: { appointmentId: row.id, type: "CANCELLED" } }), 1);
  });

  test("refuses a redeemed appointment and preserves its linked visit", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    await redeemAppointment(appointment.qrToken);
    assert.equal((await cancelAppointment(appointment.id, { actor, reason: null })).status, "not-pending");
    assert.equal(await prisma.appointment.count(), 1);
    assert.equal(await prisma.visit.count(), 1);
  });

  test("cancelling twice does not add another event; an unknown id is not-found", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    await cancelAppointment(appointment.id, { actor, reason: null });
    assert.equal((await cancelAppointment(appointment.id, { actor, reason: null })).status, "not-pending");
    assert.equal((await cancelAppointment("unknown", { actor, reason: null })).status, "not-found");
    assert.equal(await prisma.appointmentEvent.count(), 1);
  });
});

describe("rescheduling and replacement codes", () => {
  test("rescheduling keeps the QR and reference and logs the new time", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id, { scheduledFor: zonedTimeToUtc(day, "11:00") });
    const scheduledFor = zonedTimeToUtc(day, "14:00");
    const result = await rescheduleAppointment(appointment.id, scheduledFor, actor, now);
    assert.ok(result.status === "ok");
    assert.equal(result.appointment.qrToken, appointment.qrToken);
    assert.equal(result.appointment.referenceNumber, appointment.referenceNumber);
    assert.deepEqual(result.appointment.scheduledFor, scheduledFor);
    assert.deepEqual(result.appointment.expiresAt, appointmentExpiry(scheduledFor));
    assert.equal(await prisma.appointmentEvent.count({ where: { appointmentId: appointment.id, type: "RESCHEDULED" } }), 1);
    assert.equal((await rescheduleAppointment(appointment.id, scheduledFor, actor, zonedTimeToUtc(day, "14:00"))).status, "started");
  });

  test("rescheduling refuses a time already held by another pending booking", async () => {
    const host = await makeHost();
    const moving = await makeAppointment(host.id, {
      referenceNumber: "APT-MOVE01",
      scheduledFor: zonedTimeToUtc(day, "11:00"),
    });
    const occupied = await makeAppointment(host.id, {
      referenceNumber: "APT-HOLD01",
      scheduledFor: zonedTimeToUtc(day, "14:00"),
    });
    const result = await rescheduleAppointment(
      moving.id,
      occupied.scheduledFor,
      actor,
      now,
    );
    assert.equal(result.status, "slot-unavailable");
    assert.equal(
      await prisma.appointmentEvent.count({
        where: { appointmentId: moving.id, type: "RESCHEDULED" },
      }),
      0,
    );
  });

  test("regenerating a QR invalidates the old token while retaining the reference", async () => {
    const host = await makeHost();
    const appointment = await makeAppointment(host.id);
    const result = await regenerateQrToken(appointment.id, actor);
    assert.ok(result.status === "ok");
    assert.notEqual(result.appointment.qrToken, appointment.qrToken);
    assert.equal(result.appointment.referenceNumber, appointment.referenceNumber);
    const old = await validateAppointmentToken(appointment.qrToken);
    assert.ok(!old.ok && old.reason === "NOT_FOUND");
    assert.equal((await validateAppointmentToken(result.appointment.qrToken)).ok, true);
  });
});

describe("the staff list", () => {
  test("separates site today from upcoming dates and keeps statuses in chronological order", async () => {
    const host = await makeHost();
    await makeAppointment(host.id, { referenceNumber: "APT-LATER0", firstName: "Later", scheduledFor: zonedTimeToUtc(day, "12:00") });
    await makeAppointment(host.id, { referenceNumber: "APT-SOON00", firstName: "Soon", scheduledFor: zonedTimeToUtc(day, "11:00") });
    await makeAppointment(host.id, { referenceNumber: "APT-DONE00", firstName: "Gone", status: "CHECKED_IN", scheduledFor: zonedTimeToUtc(day, "09:00") });
    await makeAppointment(host.id, { referenceNumber: "APT-NEXT00", firstName: "Tomorrow", scheduledFor: zonedTimeToUtc(addDaysToKey(day, 1), "09:00") });
    await makeAppointment(host.id, { referenceNumber: "APT-OLDER0", scheduledFor: zonedTimeToUtc(addDaysToKey(day, -2), "09:00") });
    const lists = await listStaffAppointments(now);
    assert.equal(lists.todayKey, day);
    assert.deepEqual(lists.today.map((appointment) => appointment.firstName), ["Gone", "Soon", "Later"]);
    assert.deepEqual(lists.upcoming.map((appointment) => appointment.firstName), ["Tomorrow"]);
    assert.equal(lists.today[0].open, false);
    assert.equal(lists.today[1].open, true);
  });
});
