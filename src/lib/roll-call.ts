import "server-only";

import { prisma } from "@/lib/prisma";
import { closeStaleVisits } from "@/lib/stale-visits";
import { formatFullName } from "@/lib/names";
import type { RollCallSnapshot } from "@/lib/roll-call-types";

/** An emergency read must finish the existing closing rule, even after a recent sweep. */
export async function getRollCall(now = new Date()): Promise<RollCallSnapshot> {
  await closeStaleVisits(now);
  const visits = await prisma.visit.findMany({
    where: {
      status: { in: ["ACTIVE", "PENDING_RETURN"] },
      closedAutomatically: false,
      visitor: { type: { not: "DELIVERY" } },
    },
    select: {
      id: true, status: true, checkInTime: true, exitTime: true,
      visitor: { select: {
        firstName: true, lastName: true, type: true, recipientDepartment: true,
        host: { select: { name: true, department: true } },
      } },
    },
  });
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const sorted = visits.map(visit => ({ status: visit.status, row: {
    id: visit.id, name: formatFullName(visit.visitor.firstName, visit.visitor.lastName),
    type: visit.visitor.type, destination: visit.visitor.host?.name ?? visit.visitor.recipientDepartment ?? "Not recorded",
    department: visit.visitor.host?.department ?? null,
    checkInTime: visit.checkInTime.toISOString(), exitTime: visit.exitTime?.toISOString() ?? null,
  } })).sort((a, b) => collator.compare(a.row.destination, b.row.destination) || collator.compare(a.row.name, b.row.name) || a.row.id.localeCompare(b.row.id));
  // Return only the fields the staff list needs, with separate headcounts.
  return {
    onSite: sorted.filter(visit => visit.status === "ACTIVE").map(visit => visit.row),
    expectedBack: sorted.filter(visit => visit.status === "PENDING_RETURN").map(visit => visit.row),
    updatedAt: now.toISOString(),
  };
}
