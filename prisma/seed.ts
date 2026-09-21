import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const hosts = [
  { name: "Jeffrey E.", department: "Human Resources" },
  { name: "Benjamin N.", department: "Facilities & Security" },
  { name: "Charlie K.", department: "Sales" },
];

/**
 * Sample pre-registered visits for testing the kiosk appointment lookup.
 * `hostName` is resolved to a real `hostId` below.
 *
 * APT-1004 is seeded as already redeemed so the "already used" error path can
 * be exercised without having to check in first.
 */
const appointments = [
  {
    referenceNumber: "APT-1001",
    visitorName: "Marcus Delgado",
    purpose: "Quarterly vendor review",
    hostName: "Charlie K.",
    used: false,
  },
  {
    referenceNumber: "APT-1002",
    visitorName: "Sofia Lindqvist",
    purpose: "Candidate interview",
    hostName: "Jeffrey E.",
    used: false,
  },
  {
    referenceNumber: "APT-1003",
    visitorName: "Tunde Bakare",
    purpose: "Fire safety inspection",
    hostName: "Benjamin N.",
    used: false,
  },
  {
    referenceNumber: "APT-1004",
    visitorName: "Hannah Weiss",
    purpose: "Contract signing",
    hostName: "Charlie K.",
    used: true,
  },
];

// TEMP: dev-only auth — these plaintext passwords are compared directly in
// `src/lib/dev-auth.ts`. Once Better Auth is switched on, seed users through
// `auth.api.signUpEmail(...)` instead so the credential is hashed on `Account`.
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
  for (const host of hosts) {
    // `Host` has no unique business key, so match on name to stay idempotent.
    const existing = await prisma.host.findFirst({ where: { name: host.name } });

    if (existing) {
      await prisma.host.update({ where: { id: existing.id }, data: host });
    } else {
      await prisma.host.create({ data: host });
    }
  }

  for (const { hostName, ...appointment } of appointments) {
    const host = await prisma.host.findFirst({ where: { name: hostName } });

    if (!host) {
      throw new Error(`Seed host "${hostName}" not found for ${appointment.referenceNumber}`);
    }

    const data = { ...appointment, hostId: host.id };

    // Re-seeding resets `used` back to its fixture value, so the appointment
    // flow can be tested repeatedly without hand-editing the database.
    await prisma.appointment.upsert({
      where: { referenceNumber: appointment.referenceNumber },
      update: data,
      create: data,
    });
  }

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: user,
    });
  }

  console.log(`Seeded ${hosts.length} hosts.`);
  console.log(
    `Seeded ${appointments.length} appointments (${appointments
      .map((a) => a.referenceNumber)
      .join(", ")}; APT-1004 is pre-used).`,
  );
  console.log("Seeded users (TEMP dev-only plaintext credentials):");
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
