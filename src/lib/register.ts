import "server-only";

import { addDaysToKey, zonedTimeToUtc } from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";
import { sweepStaleVisitsIfDue } from "@/lib/stale-visits";

export async function getDailyRegister(date: string) {
  await sweepStaleVisitsIfDue();
  const visits = await prisma.visit.findMany({
    where: { checkInTime: { gte: zonedTimeToUtc(date, "00:00"), lt: zonedTimeToUtc(addDaysToKey(date, 1), "00:00") } },
    orderBy: [{ checkInTime: "asc" }, { id: "asc" }],
    include: { visitor: { include: { host: true, purpose: true } } },
  });
  return {
    visits,
    summary: {
      total: visits.length,
      deliveries: visits.filter((visit) => visit.visitor.type === "DELIVERY").length,
      onSite: visits.filter((visit) => !visit.closedAutomatically && visit.status === "ACTIVE").length,
      autoClosed: visits.filter((visit) => visit.closedAutomatically).length,
    },
  };
}
