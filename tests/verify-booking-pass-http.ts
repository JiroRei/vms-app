/** Manual check against the running local app; removes its own temporary data. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { addDaysToKey, checkSlot, dateKeyInZone, SLOT_TIMES } from "@/lib/booking-config";
import { BOOKING_PASS_COOKIE_NAME, BOOKING_PASS_COOKIE_PATH } from "@/lib/booking-pass";
import { issueVerificationCode, VERIFIED_COOKIE_NAME } from "@/lib/booking-verification";
import { makeNameKey } from "@/lib/names";
import { signPassToken } from "@/lib/pass-token";
import { prisma } from "@/lib/prisma";

async function main() {
  const origin = "http://localhost:3000";
  assert.ok(!process.env.RESEND_API_KEY || !process.env.APPOINTMENT_FROM_EMAIL, "Use unconfigured mail for this local check.");
  const id = `bookingqr-${randomUUID()}`;
  const profileId = `${id}-profile`;
  const email = `${id}@example.invalid`;
  const identity = { email, firstName: "José", lastName: "Booking" };
  const nameKey = makeNameKey(identity.firstName, identity.lastName);
  const expiresAt = new Date(Date.now() + 86_400_000);
  const token = (version = 1) => signPassToken({ passId: id, version, secret: process.env.PASS_SECRET! });
  const post = (path: string, body: unknown, cookie?: string) => fetch(`${origin}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": id, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  function readCookie(response: Response, name: string) {
    const value = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
    assert.ok(value, `Missing ${name} cookie`);
    return { header: value, pair: value.split(";")[0] };
  }
  function assertCleared(response: Response, name: string) {
    const cookie = readCookie(response, name);
    assert.equal(cookie.pair, `${name}=`);
    const expires = /Expires=([^;]+)/i.exec(cookie.header)?.[1];
    assert.ok(cookie.header.includes("Max-Age=0") || (expires && Date.parse(expires) < Date.now()));
  }
  const schedules: string[] = [];
  for (let offset = 1; offset < 8 && schedules.length < 2; offset++) {
    for (const time of SLOT_TIMES) {
      const value = `${addDaysToKey(dateKeyInZone(new Date()), offset)}T${time}`;
      if (checkSlot(value, new Date()).ok) schedules.push(value);
      if (schedules.length === 2) break;
    }
  }
  assert.equal(schedules.length, 2);
  try {
    await prisma.host.create({ data: { id, name: "Booking QR test host", department: "Testing" } });
    await prisma.purposeOption.create({ data: { id, label: id } });
    await prisma.visitorProfile.create({ data: { id: profileId, ...identity, nameKey, phone: "+63 917 000 0000" } });
    await prisma.visitorPass.create({ data: { id, profileId, expiresAt, issueReason: "STAFF_ISSUED" } });
    let refusal: unknown;
    for (const value of [id, randomUUID(), "", token().slice(0, -1) + (token().endsWith("A") ? "B" : "A")]) {
      const response = await post("/api/booking/pass/verify", { token: value });
      assert.equal(response.status, 403);
      const data = await response.json();
      if (!refusal) refusal = data;
      else assert.deepEqual(data, refusal);
      assert.equal(response.headers.getSetCookie().length, 0);
    }
    const lookup = await post("/api/booking/pass/verify", { token: ` ${token()} ` });
    assert.equal(lookup.status, 200);
    assert.deepEqual(await lookup.json(), { email, firstName: "José", lastName: "Booking", phone: "+63 917 000 0000" });
    const cookie = readCookie(lookup, BOOKING_PASS_COOKIE_NAME);
    assert.ok(cookie.header.includes("HttpOnly"));
    assert.ok(cookie.header.includes(`Path=${BOOKING_PASS_COOKIE_PATH}`));
    assert.ok(cookie.header.includes("Max-Age=1800"));
    assert.equal(lookup.headers.get("cache-control"), "private, no-store");
    const passAfterLookup = await prisma.visitorPass.findUniqueOrThrow({ where: { id } });
    assert.equal(passAfterLookup.lastUsedAt, null);
    assert.equal(passAfterLookup.expiresAt.getTime(), expiresAt.getTime());
    const manage = await fetch(`${origin}/appointment-booking/manage`, { headers: { Cookie: cookie.pair } });
    assert.equal(manage.status, 200);
    assert.ok((await manage.text()).includes("Sign in with the email and name"));
    const payload = { firstName: identity.firstName, lastName: identity.lastName, visitorEmail: email, visitorPhone: "+63 917 000 0000", hostId: id, purposeId: id, scheduledFor: schedules[0], consent: true };
    const booked = await post("/api/appointments", payload, cookie.pair);
    assert.equal(booked.status, 201);
    const booking = await booked.json();
    const row = await prisma.appointment.findUniqueOrThrow({ where: { referenceNumber: booking.appointment.referenceNumber } });
    assert.equal(row.visitorProfileId, profileId);
    assert.ok(readCookie(booked, BOOKING_PASS_COOKIE_NAME).header.includes(`Path=${BOOKING_PASS_COOKIE_PATH}`));
    assertCleared(booked, BOOKING_PASS_COOKIE_NAME);
    assert.equal(await prisma.visit.count({ where: { visitorProfileId: profileId } }), 0);
    const anotherLookup = await post("/api/booking/pass/verify", { token: token() });
    assert.equal(anotherLookup.status, 200);
    const pendingCookie = readCookie(anotherLookup, BOOKING_PASS_COOKIE_NAME);
    await prisma.visitorPass.update({ where: { id }, data: { status: "REVOKED" } });
    const refused = await post("/api/appointments", { ...payload, scheduledFor: schedules[1] }, pendingCookie.pair);
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).reauthenticate, true);
    assert.equal(await prisma.appointment.count({ where: { hostId: id } }), 1);
    // Exercise the existing email-code fallback without sending an email.
    const code = await issueVerificationCode(identity);
    assert.equal(code.status, "issued");
    assert.ok(code.status === "issued" && code.delivery);
    const verified = await post("/api/booking/verify", { ...identity, code: code.delivery.code });
    assert.equal(verified.status, 200);
    const emailCookie = readCookie(verified, VERIFIED_COOKIE_NAME);
    assertCleared(verified, BOOKING_PASS_COOKIE_NAME);
    const fallbackBooking = await post("/api/appointments", { ...payload, scheduledFor: schedules[1] }, emailCookie.pair);
    assert.equal(fallbackBooking.status, 201);
    const fallback = await fallbackBooking.json();
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { referenceNumber: fallback.appointment.referenceNumber } })).visitorProfileId, profileId);
    const signOut = await post("/api/booking/sign-out", {});
    assert.equal(signOut.status, 200);
    assertCleared(signOut, BOOKING_PASS_COOKIE_NAME);
    console.log("HTTP booking QR checks passed: safe prefill, scoped cookie, linked booking, no check-in/renewal, revocation recheck, email-code fallback and cookie cleanup.");
  } finally {
    await prisma.appointment.deleteMany({ where: { hostId: id } });
    await prisma.visitorVerification.deleteMany({ where: { email } });
    await prisma.visitorProfile.deleteMany({ where: { id: profileId } });
    await prisma.host.deleteMany({ where: { id } });
    await prisma.purposeOption.deleteMany({ where: { id } });
    await prisma.$disconnect();
    console.log("Temporary booking QR verification records removed.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
