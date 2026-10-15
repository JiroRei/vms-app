import "server-only";

import { getHistoryQuery } from "@/lib/history";
import { prisma } from "@/lib/prisma";
import { sweepStaleVisitsIfDue } from "@/lib/stale-visits";
import { csvRow, reportCheckInMethod, reportStatus, reportTimestamp } from "@/lib/visit-report";

const BATCH_SIZE = 1000;
export const CSV_COLUMNS = [
  "Visit ID", "Date", "Check-in time", "Check-out time", "First name", "Last name",
  "Type", "Purpose", "Host/destination", "Department", "Check-in method", "Checked in by",
  "Appointment reference", "Status", "Duration in minutes",
] as const;

export async function createVisitExport(userId: string, query: ReturnType<typeof getHistoryQuery>) {
  await sweepStaleVisitsIfDue();
  const now = new Date();
  const { search, hostId, from, to, type, hideDeliveries } = query.filters;
  const filters = { search, hostId, from, to, type, hideDeliveries };
  // TODO(multi-tenancy): associate this audit and the visit query with the user's organization.
  const log = await prisma.exportLog.create({ data: { userId, filters, rowCount: 0 } });
  let rowCount = 0;
  let cursor: string | undefined;
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\uFEFF" + csvRow(CSV_COLUMNS)));
    },
    async pull(controller) {
      try {
        const visits = await prisma.visit.findMany({
          where: { AND: [query.where, { createdAt: { lte: now } }] },
          orderBy: [{ checkInTime: "desc" }, { id: "desc" }],
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            visitor: { include: { host: true, purpose: true } },
            checkedInByUser: { select: { name: true } },
            appointment: { select: { referenceNumber: true } },
          },
        });
        if (cancelled) return;
        const chunk = visits.map((visit) => {
          const visitor = visit.visitor;
          const elapsed = (visit.checkOutTime ?? now).getTime() - visit.checkInTime.getTime();
          return csvRow([
            visit.id, reportTimestamp(visit.checkInTime).slice(0, 10),
            reportTimestamp(visit.checkInTime), visit.checkOutTime ? reportTimestamp(visit.checkOutTime) : "",
            visitor.firstName, visitor.lastName, visitor.type === "DELIVERY" ? "Delivery" : "Guest",
            visitor.purpose?.label, visitor.host?.name ?? visitor.recipientDepartment,
            visitor.host?.department ?? visitor.recipientDepartment, reportCheckInMethod(visit),
            // Older delivery logs attributed only their simultaneous checkout.
            visit.checkedInByUser?.name ?? (visit.checkInMethod === "DELIVERY" ? visit.checkedOutByName : null),
            visit.appointment?.referenceNumber, reportStatus(visit),
            visit.closedAutomatically || elapsed < 0 ? "" : Math.floor(elapsed / 60_000),
          ]);
        }).join("");
        rowCount += visits.length;
        // Persist each completed batch, including when a download is interrupted.
        await prisma.exportLog.update({ where: { id: log.id }, data: { rowCount } });
        if (cancelled) return;
        if (chunk) controller.enqueue(encoder.encode(chunk));
        if (visits.length < BATCH_SIZE) controller.close();
        else cursor = visits[visits.length - 1].id;
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() { cancelled = true; },
  });
  return stream;
}
