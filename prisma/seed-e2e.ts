import "../tests/setup";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../src/lib/prisma";
import { resetDatabase } from "../tests/helpers";
import { makeNameKey } from "../src/lib/names";
import { dateKeyInZone, zonedTimeToUtc, addDaysToKey } from "../src/lib/booking-config";
import { appointmentExpiry } from "../src/lib/qr";

export async function seedE2e() {
  await resetDatabase();
  await prisma.host.createMany({ data: [{ id: "e2e-host", name: "E2E Host", department: "Testing" }, { id: "e2e-host-two", name: "Second Host", department: "Operations" }] });
  await prisma.purposeOption.createMany({ data: [{ id: "e2e-purpose", label: "Meeting", sortOrder: 10 }, { id: "e2e-purpose-two", label: "Interview", sortOrder: 20 }] });
  for (const role of ["ADMIN", "GUARD"] as const) {
    const id = `e2e-${role.toLowerCase()}`;
    await prisma.user.create({ data: { id, name: `E2E ${role}`, email: `${role.toLowerCase()}@e2e.invalid`, role, emailVerified: true, accounts: { create: { id: `${id}-account`, accountId: id, providerId: "credential", password: await hashPassword("E2ePassword123!") } } } });
  }
  await prisma.visitorProfile.create({ data: { id: "e2e-profile", firstName: "Returning", lastName: "Visitor", email: "returning@e2e.invalid", nameKey: makeNameKey("Returning", "Visitor"), phone: "09170000000" } });
  const now = new Date();
  await prisma.appointment.create({ data: { id: "e2e-appointment", referenceNumber: "APT-E2E001", qrToken: "11111111-1111-4111-8111-111111111111", firstName: "Seeded", lastName: "Appointment", visitorEmail: "seeded@e2e.invalid", hostId: "e2e-host", purposeId: "e2e-purpose", scheduledFor: now, expiresAt: appointmentExpiry(now) } });
  await prisma.visitor.create({ data: { id: "e2e-stale-visitor", firstName: "Stale", lastName: "Visitor", hostId: "e2e-host", purposeId: "e2e-purpose", visits: { create: { id: "e2e-stale-visit", checkInTime: zonedTimeToUtc(addDaysToKey(dateKeyInZone(now), -1), "09:00"), status: "ACTIVE" } } } });
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("seed-e2e.ts")) {
  seedE2e().finally(() => prisma.$disconnect());
}
