import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { VisitStatus, VisitorType } from "@/generated/prisma/enums";
import {
  formatShortDate,
  startOfLocalDay,
  toLocalDateKey,
} from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 25;

export type HistoryVisit = {
  id: string;
  visitorName: string;
  visitorType: VisitorType;
  purpose: string;
  /** Null for a delivery logged without a named recipient. */
  hostName: string | null;
  hostDepartment: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  /**
   * The status the visit ended up in. A visit that stepped out and came back is
   * a plain CHECKED_OUT record here — the PENDING_RETURN it passed through left
   * no trace, because it was the same row throughout. Only a visit still in
   * that state right now reports PENDING_RETURN.
   */
  status: VisitStatus;
  /**
   * Who closed the visit, as their name read at the time.
   *
   * Null means nobody did: the stale-visit cleanup closed it because it was
   * left open overnight. That is worth showing rather than hiding — "closed by
   * the system" and "closed by a person at the desk" are different records.
   */
  checkedOutByName: string | null;
};

export type HistoryFilters = {
  search: string;
  hostId: string;
  from: string;
  to: string;
  /** When true, DELIVERY rows are excluded from the table. */
  hideDeliveries: boolean;
  page: number;
};

export type HistoryPage = {
  visits: HistoryVisit[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Turns a `YYYY-MM-DD` value from a date input into a Date at the start or end
 * of that day.
 *
 * Parsed as local time deliberately: `new Date("2026-09-15")` would be UTC
 * midnight, which shifts the boundary by the server's offset and drops visits
 * from the edges of the range. A single-site VMS wants the server's own day.
 */
function parseDateBoundary(value: string, edge: "start" | "end"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(
    `${value}${edge === "start" ? "T00:00:00.000" : "T23:59:59.999"}`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function buildWhere(filters: HistoryFilters): Prisma.VisitWhereInput {
  const where: Prisma.VisitWhereInput = {};
  const visitor: Prisma.VisitorWhereInput = {};

  if (filters.search.trim()) {
    visitor.name = { contains: filters.search.trim(), mode: "insensitive" };
  }

  if (filters.hostId) {
    visitor.hostId = filters.hostId;
  }

  if (filters.hideDeliveries) {
    visitor.type = "GUEST";
  }

  if (Object.keys(visitor).length > 0) {
    where.visitor = visitor;
  }

  const from = parseDateBoundary(filters.from, "start");
  const to = parseDateBoundary(filters.to, "end");

  if (from || to) {
    where.checkInTime = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  return where;
}

export async function getVisitHistory(
  filters: HistoryFilters,
): Promise<HistoryPage> {
  const where = buildWhere(filters);

  const total = await prisma.visit.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamp so a stale ?page= from a since-narrowed filter still returns rows.
  const page = Math.min(Math.max(1, filters.page), pageCount);

  const visits = await prisma.visit.findMany({
    where,
    orderBy: { checkInTime: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { visitor: { include: { host: true } } },
  });

  return {
    total,
    page,
    pageCount,
    visits: visits.map((visit) => ({
      id: visit.id,
      visitorName: visit.visitor.name,
      visitorType: visit.visitor.type,
      purpose: visit.visitor.purpose,
      hostName: visit.visitor.host?.name ?? null,
      hostDepartment: visit.visitor.host?.department ?? null,
      checkInTime: visit.checkInTime.toISOString(),
      checkOutTime: visit.checkOutTime?.toISOString() ?? null,
      status: visit.status,
      checkedOutByName: visit.checkedOutByName,
    })),
  };
}

export type FrequencyPoint = {
  /** `YYYY-MM-DD`, in the server's local time zone. */
  date: string;
  label: string;
  count: number;
};

/**
 * Visit counts per day for the last `days` days, inclusive of today.
 *
 * Aggregated in memory: the row count here is small, and doing it in JS keeps
 * the day boundaries in the same local time zone as the rest of the page.
 * Days with no visits are returned as zeroes so the chart has no gaps.
 */
export async function getVisitorFrequency(
  days: number,
): Promise<FrequencyPoint[]> {
  const start = startOfLocalDay();
  start.setDate(start.getDate() - (days - 1));

  const visits = await prisma.visit.findMany({
    where: { checkInTime: { gte: start } },
    select: { checkInTime: true },
  });

  const counts = new Map<string, number>();

  for (const visit of visits) {
    const key = toLocalDateKey(visit.checkInTime);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);

    const key = toLocalDateKey(date);

    return {
      date: key,
      label: formatShortDate(date),
      count: counts.get(key) ?? 0,
    };
  });
}
