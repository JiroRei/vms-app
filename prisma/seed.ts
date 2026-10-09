import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
// The same scrypt hasher Better Auth verifies against at sign-in, imported
// directly so the seed does not have to stand up an auth instance (which pulls
// in `server-only` and a Next.js request context that a script has neither of).
import { hashPassword } from "better-auth/crypto";

import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const hosts = [
  { name: "Jeffrey E.", department: "Human Resources" },
  { name: "Benjamin N.", department: "Facilities & Security" },
  { name: "Charlie K.", department: "Sales" },
];

/**
 * The purpose dropdown's starting contents.
 *
 * `sortOrder` starts at 10 and steps by 10 so these sit above anything the
 * migration backfilled from the old free-text column, which numbered from 1000
 * — the defaults should be what a visitor sees first. "Other" is last on
 * purpose: it is the escape hatch, not a first choice.
 *
 * TODO(multi-tenancy): these are seeded once for the whole app. Once
 * organizations exist, every new organization needs its own copy of this list.
 * See MULTI_TENANCY_TODO.md.
 */
const purposeOptions = [
  { label: "Meeting", sortOrder: 10 },
  { label: "Interview", sortOrder: 20 },
  { label: "Delivery", sortOrder: 30 },
  { label: "Maintenance", sortOrder: 40 },
  { label: "Other", sortOrder: 50 },
];

const HOUR_MS = 60 * 60 * 1000;

/** Two hours out, so a freshly seeded appointment is always still valid. */
const soon = new Date(Date.now() + 2 * HOUR_MS);
/** Yesterday, for the fixture that must read as lapsed. */
const yesterday = new Date(Date.now() - 24 * HOUR_MS);

/**
 * Mirrors `APPOINTMENT_GRACE_HOURS` in `src/lib/qr.ts`, which this file cannot
 * import — that module is `server-only` and the seed runs outside Next.
 */
const GRACE_HOURS = 4;

function expiryFor(scheduledFor: Date): Date {
  return new Date(scheduledFor.getTime() + GRACE_HOURS * HOUR_MS);
}

/**
 * Sample pre-registered visits for testing the kiosk and the guard scanner.
 * `hostName` is resolved to a real `hostId` below.
 *
 * `qrToken` is fixed per fixture rather than random, so a re-seed does not
 * invalidate a QR code someone already printed for testing, and so a test can
 * scan a known token. Real bookings mint a fresh `crypto.randomUUID()`.
 *
 * The last three exist to exercise the dead ends without hand-editing the
 * database: one already checked in, one cancelled, one lapsed.
 */
const appointments = [
  {
    referenceNumber: "APT-1001",
    qrToken: "11111111-1111-4111-8111-111111111111",
    firstName: "Marcus",
    lastName: "Delgado",
    visitorEmail: "marcus.delgado@example.com",
    visitorPhone: "+63 917 000 1001",
    purposeLabel: "Meeting",
    hostName: "Charlie K.",
    scheduledFor: soon,
    status: "PENDING" as const,
  },
  {
    referenceNumber: "APT-1002",
    qrToken: "22222222-2222-4222-8222-222222222222",
    firstName: "Sofia",
    lastName: "Lindqvist",
    visitorEmail: "sofia.lindqvist@example.com",
    visitorPhone: null,
    purposeLabel: "Interview",
    hostName: "Jeffrey E.",
    scheduledFor: soon,
    status: "PENDING" as const,
  },
  {
    referenceNumber: "APT-1003",
    qrToken: "33333333-3333-4333-8333-333333333333",
    firstName: "Tunde",
    lastName: "Bakare",
    visitorEmail: "tunde.bakare@example.com",
    visitorPhone: null,
    purposeLabel: "Maintenance",
    hostName: "Benjamin N.",
    scheduledFor: soon,
    status: "PENDING" as const,
  },
  {
    referenceNumber: "APT-1004",
    qrToken: "44444444-4444-4444-8444-444444444444",
    firstName: "Hannah",
    lastName: "Weiss",
    visitorEmail: "hannah.weiss@example.com",
    visitorPhone: null,
    purposeLabel: "Meeting",
    hostName: "Charlie K.",
    scheduledFor: soon,
    status: "CHECKED_IN" as const,
  },
  {
    referenceNumber: "APT-1005",
    qrToken: "55555555-5555-4555-8555-555555555555",
    firstName: "Priya",
    lastName: "Raman",
    visitorEmail: "priya.raman@example.com",
    visitorPhone: null,
    purposeLabel: "Meeting",
    hostName: "Benjamin N.",
    scheduledFor: soon,
    status: "CANCELLED" as const,
  },
  {
    referenceNumber: "APT-1006",
    qrToken: "66666666-6666-4666-8666-666666666666",
    firstName: "Diego",
    lastName: "Santos",
    visitorEmail: "diego.santos@example.com",
    visitorPhone: null,
    purposeLabel: "Delivery",
    hostName: "Jeffrey E.",
    // Left PENDING on purpose: nothing sweeps lapsed appointments into the
    // EXPIRED status, so this is what a real expired one looks like — the
    // `expiresAt` check is what turns it away.
    scheduledFor: yesterday,
    status: "PENDING" as const,
  },
];

// The staff logins. Sign-up is disabled on the API, so this is the only way an
// account comes into existence — the passwords below are hashed before they
// reach the database, and are known only because this file is the fixture.
//
// One of each role, so role-gated behaviour can be checked both ways without
// hand-editing the database: the admin sees "Close all stale visits", the guard
// does not, and `POST /api/visits/close-stale` rejects the guard with 403.
const users = [
  {
    email: "admin@geoplan.ph",
    name: "VMS Administrator",
    role: "ADMIN" as const,
    password: "admin123",
  },
  {
    email: "guard@geoplan.ph",
    name: "Front Desk Guard",
    role: "GUARD" as const,
    password: "guard123",
  },
];

async function main() {
  // Seeded first: the appointment fixtures below resolve their `purposeLabel`
  // against these. Upserting by label means a re-seed re-activates and
  // re-orders a default an admin had hidden or moved, without creating a
  // duplicate or disturbing the options the backfill created.
  for (const option of purposeOptions) {
    await prisma.purposeOption.upsert({
      where: { label: option.label },
      update: { sortOrder: option.sortOrder, isActive: true },
      create: option,
    });
  }

  for (const host of hosts) {
    // `Host` has no unique business key, so match on name to stay idempotent.
    const existing = await prisma.host.findFirst({ where: { name: host.name } });

    if (existing) {
      await prisma.host.update({ where: { id: existing.id }, data: host });
    } else {
      await prisma.host.create({ data: host });
    }
  }

  for (const { hostName, purposeLabel, ...appointment } of appointments) {
    const host = await prisma.host.findFirst({ where: { name: hostName } });

    if (!host) {
      throw new Error(`Seed host "${hostName}" not found for ${appointment.referenceNumber}`);
    }

    const purpose = await prisma.purposeOption.findUnique({
      where: { label: purposeLabel },
    });

    if (!purpose) {
      throw new Error(
        `Seed purpose "${purposeLabel}" not found for ${appointment.referenceNumber}`,
      );
    }

    const data = {
      ...appointment,
      hostId: host.id,
      purposeId: purpose.id,
      expiresAt: expiryFor(appointment.scheduledFor),
    };

    // Re-seeding resets `status` and pushes `scheduledFor` forward again, so
    // the appointment flow can be tested repeatedly without hand-editing the
    // database.
    await prisma.appointment.upsert({
      where: { referenceNumber: appointment.referenceNumber },
      update: data,
      create: data,
    });
  }

  for (const { password, ...user } of users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, emailVerified: true },
      create: { ...user, emailVerified: true },
    });

    // Better Auth keeps the credential on an `account` row, and sign-in matches
    // it on two things at once: `providerId` is "credential" and `accountId` is
    // the user's own id. A row with either one wrong is not found, and the user
    // gets "invalid email or password" with a perfectly good password.
    const credential = await prisma.account.findFirst({
      where: { userId: record.id, providerId: "credential" },
      select: { id: true },
    });

    const data = {
      accountId: record.id,
      providerId: "credential",
      userId: record.id,
      password: await hashPassword(password),
    };

    if (credential) {
      // Re-hashes on every run, so re-seeding resets a password that has since
      // been changed — the same way it resets APT-1004 back to used.
      await prisma.account.update({ where: { id: credential.id }, data });
    } else {
      // Better Auth generates ids for its own tables, so the column has no
      // default and a direct insert has to supply one.
      await prisma.account.create({ data: { id: randomUUID(), ...data } });
    }
  }

  console.log(`Seeded ${hosts.length} hosts.`);
  console.log(
    `Seeded ${purposeOptions.length} purpose options: ${purposeOptions
      .map((option) => option.label)
      .join(", ")}.`,
  );
  console.log(`Seeded ${appointments.length} appointments:`);
  for (const appointment of appointments) {
    const lapsed = appointment.scheduledFor.getTime() < Date.now();
    const note =
      appointment.status === "PENDING" && lapsed ? "EXPIRED (lapsed)" : appointment.status;
    console.log(
      `  ${appointment.referenceNumber}  ${note.padEnd(16)} qr=${appointment.qrToken}`,
    );
  }
  console.log("Seeded staff logins (passwords are hashed on `account`):");
  for (const user of users) {
    console.log(`  ${user.role.padEnd(5)} ${user.email} / ${user.password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
