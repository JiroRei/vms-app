import "dotenv/config";

import { randomUUID } from "node:crypto";

import { databaseAdapter, databaseConfig } from "../src/lib/database-config";
// The same scrypt hasher Better Auth verifies against at sign-in, imported
// directly so the seed does not have to stand up an auth instance (which pulls
// in `server-only` and a Next.js request context that a script has neither of).
import { hashPassword } from "better-auth/crypto";

import { PrismaClient } from "../src/generated/prisma/client";

const target = databaseConfig(process.env.DATABASE_URL);
console.log(`Seed target: database=${target.database} schema=${target.schema} host=${target.host}`);
const adapter = databaseAdapter(process.env.DATABASE_URL);
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
  if (!process.argv.includes("--force") && await prisma.user.count({ where: { role: { in: ["ADMIN", "GUARD"] } } })) {
    throw new Error("Refusing to seed a database with staff accounts. Pass --force to create missing records; existing data and passwords will be preserved.");
  }
  // Existing purpose labels, ordering and activation belong to the operator.
  for (const option of purposeOptions) {
    const existing = await prisma.purposeOption.findFirst({
      where: { label: { equals: option.label, mode: "insensitive" } },
      select: { id: true },
    });
    if (!existing) await prisma.purposeOption.create({ data: option });
  }

  for (const host of hosts) {
    // `Host` has no unique business key, so match on name to stay idempotent.
    const existing = await prisma.host.findFirst({ where: { name: host.name } });

    if (!existing) await prisma.host.create({ data: host });
  }

  for (const { hostName, purposeLabel, ...appointment } of appointments) {
    if (await prisma.appointment.findUnique({ where: { referenceNumber: appointment.referenceNumber } })) continue;
    const host = await prisma.host.findFirst({ where: { name: hostName } });

    if (!host) {
      throw new Error(`Seed host "${hostName}" not found for ${appointment.referenceNumber}`);
    }

    const purpose = await prisma.purposeOption.findFirst({
      where: { label: { equals: purposeLabel, mode: "insensitive" } },
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

    await prisma.appointment.create({ data });
  }

  for (const { password, ...user } of users) {
    // Skip the entire identity, including its credentials, when it exists.
    if (await prisma.user.findUnique({ where: { email: user.email } })) continue;
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        ...user,
        emailVerified: true,
        accounts: { create: {
          id: randomUUID(),
          // Better Auth's credential accountId must match the user's id.
          accountId: id,
          providerId: "credential",
          password: await hashPassword(password),
        } },
      },
    });
  }

  console.log("Seed complete: missing records created; existing records preserved.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
