import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";

async function main() {
  const counts = await Promise.all([
    prisma.host.count({ where: { id: { startsWith: "e2e-" } } }),
    prisma.user.count({ where: { email: { endsWith: "@e2e.invalid" } } }),
    prisma.appointment.count({ where: { visitorEmail: { endsWith: "@e2e.invalid" } } }),
    prisma.visitorProfile.count({ where: { email: { endsWith: "@e2e.invalid" } } }),
    prisma.visitor.count({ where: { OR: [{ id: { startsWith: "e2e-" } }, { id: { startsWith: "roll-call-e2e-" } }, { firstName: { in: ["Walkin", "Booked"] }, lastName: "E2e" }, { firstName: "E2E Courier" }] } }),
    prisma.visit.count({ where: { id: { startsWith: "roll-call-e2e-" } } }),
    prisma.emailOutbox.count({ where: { to: { endsWith: "@e2e.invalid" } } }),
    prisma.kioskDevice.count({ where: { deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }),
  ]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 0, "Test fixtures were found in the development schema.");
  console.log("Development schema audit passed: no E2E fixtures or verification rows were created there; no cleanup was needed.");
}
main().finally(() => prisma.$disconnect());
