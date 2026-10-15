import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { readBookingPassClaim, verifyBookingPass } from "@/lib/booking-pass";
import { resolveBookingProfile } from "@/lib/booking-verification";
import { makeNameKey } from "@/lib/names";
import { signPassToken } from "@/lib/pass-token";
import { prisma } from "@/lib/prisma";

const prefix = `bookingpass-${randomUUID()}`;
const profileId = `${prefix}-holder`;
const otherProfileId = `${prefix}-other`;
const passId = prefix;
const email = `${prefix}@example.invalid`;
const now = new Date("2026-10-12T05:00:00Z");
const secret = "test-booking-pass-secret-01234567890123456789";
const previousSecret = process.env.PASS_SECRET;
const token = (version = 1) => signPassToken({ passId, version, secret });

before(async () => {
  process.env.PASS_SECRET = secret;
  await prisma.visitorProfile.createMany({ data: [
    { id: profileId, email, firstName: "José", lastName: "García", nameKey: makeNameKey("José", "García"), phone: "+63 917 000 0000" },
    { id: otherProfileId, email, firstName: "Other", lastName: "Person", nameKey: makeNameKey("Other", "Person") },
  ] });
  await prisma.visitorPass.create({ data: { id: passId, profileId, issueReason: "STAFF_ISSUED", expiresAt: new Date(now.getTime() + 86_400_000) } });
});

after(async () => {
  await prisma.visitorProfile.deleteMany({ where: { id: { in: [profileId, otherProfileId] } } });
  if (previousSecret === undefined) delete process.env.PASS_SECRET;
  else process.env.PASS_SECRET = previousSecret;
  await prisma.$disconnect();
});

test("a signed pass returns saved details without a check-in or renewal", async () => {
  const before = await prisma.visitorPass.findUniqueOrThrow({ where: { id: passId } });
  const details = await verifyBookingPass(`  ${token()}  `, now);
  assert.deepEqual(details, { id: profileId, email, firstName: "José", lastName: "García", nameKey: "jose|garcia", phone: "+63 917 000 0000" });
  const after = await prisma.visitorPass.findUniqueOrThrow({ where: { id: passId } });
  assert.equal(after.lastUsedAt, null);
  assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
  assert.equal(await prisma.visit.count({ where: { visitorProfileId: profileId } }), 0);
});

test("bare IDs, appointment QRs, nonexistent passes and forged codes reveal nothing", async () => {
  const bad = token().slice(0, -1) + (token().endsWith("A") ? "B" : "A");
  for (const value of ["", passId, randomUUID(), bad, signPassToken({ passId: "missingpass00000001", version: 1, secret }), "x".repeat(201)]) {
    assert.equal(await verifyBookingPass(value, now), null);
  }
});

test("a pass claim links only its own name/email pair, including shared email addresses", async () => {
  const claim = await readBookingPassClaim(token(), now);
  assert.ok(claim);
  const holder = await prisma.$transaction((tx) => resolveBookingProfile(tx, { verified: claim, email, firstName: "jose", lastName: "garcia", phone: null }));
  assert.equal(holder.visitorProfileId, profileId);
  assert.equal(holder.firstName, "José");
  const other = await prisma.$transaction((tx) => resolveBookingProfile(tx, { verified: claim, email, firstName: "Other", lastName: "Person", phone: null }));
  assert.equal(other.visitorProfileId, null);
});

test("a booking proof is rechecked after rotation, revocation and expiry", async () => {
  assert.ok(await readBookingPassClaim(token(), now));
  await prisma.visitorPass.update({ where: { id: passId }, data: { version: 2 } });
  assert.equal(await readBookingPassClaim(token(), now), null);
  assert.ok(await readBookingPassClaim(token(2), now));
  await prisma.visitorPass.update({ where: { id: passId }, data: { status: "REVOKED" } });
  assert.equal(await readBookingPassClaim(token(2), now), null);
  await prisma.visitorPass.update({ where: { id: passId }, data: { status: "ACTIVE", expiresAt: now } });
  assert.equal(await readBookingPassClaim(token(2), now), null);
});
