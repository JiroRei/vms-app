import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { VisitStatus, VisitorType } from "@/generated/prisma/enums";
import { startOfLocalDay, toLocalDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 25;

export type HistoryVisit = {
  id: string;
  /** Display with `formatFullName()`. */
  firstName: string;
  lastName: string;
  visitorType: VisitorType;
  /** The chosen option's label. Null if the visit carries no purpose at all. */
  purposeLabel: string | null;
  /** Null when no host was picked — every delivery, and nothing else. */
  hostName: string | null;
  hostDepartment: string | null;
  /** The typed-in destination for a delivery whose recipient is not a host. */
  recipientDepartment: string | null;
  /** The guard's note from the delivery modal, when they left one. */
  note: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  /**
   * The status the visit ended up in. A visit that stepped out and came back is
   * a plain CHECKED_OUT record here — the PENDING_RETURN it passed through left
   * no trace, because it was the same row throughout. Only a visit still in
   * that state right now reports PENDING_RETURN.
   */
  status: VisitStatus;
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

/**
 * Case-insensitive substring match against a visitor's first name, last name,
 * or the full "first last" text.
 *
 * The full text is never stored, so a query that spans the gap between the two
 * parts ("ada love", "n smi") is matched piecewise: for each space in the
 * query, the part before it must end the first name and the part after it must
 * start the last name. Together with plain `contains` on each part, that is
 * exactly "the query appears somewhere in `first last`".
 */
export function nameSearchWhere(query: string): Prisma.VisitorWhereInput {
  const q = query.trim().replace(/\s+/g, " ");
  const mode = "insensitive" as const;

  const spans: Prisma.VisitorWhereInput[] = [];
  for (let at = q.indexOf(" "); at !== -1; at = q.indexOf(" ", at + 1)) {
    const before = q.slice(0, at);
    const after = q.slice(at + 1);
    spans.push({
      AND: [
        before ? { firstName: { endsWith: before, mode } } : {},
        after ? { lastName: { startsWith: after, mode } } : {},
      ],
    });
  }

  return {
    OR: [
      { firstName: { contains: q, mode } },
      { lastName: { contains: q, mode } },
      ...spans,
    ],
  };
}

function buildWhere(filters: HistoryFilters): Prisma.VisitWhereInput {
  const where: Prisma.VisitWhereInput = {};
  const visitor: Prisma.VisitorWhereInput = {};

  if (filters.search.trim()) {
    Object.assign(visitor, nameSearchWhere(filters.search));
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
    include: { visitor: { include: { host: true, purpose: true } } },
  });

  return {
    total,
    page,
    pageCount,
    visits: visits.map((visit) => ({
      id: visit.id,
      firstName: visit.visitor.firstName,
      lastName: visit.visitor.lastName,
      visitorType: visit.visitor.type,
      purposeLabel: visit.visitor.purpose?.label ?? null,
      hostName: visit.visitor.host?.name ?? null,
      hostDepartment: visit.visitor.host?.department ?? null,
      recipientDepartment: visit.visitor.recipientDepartment,
      note: visit.visitor.note,
      checkInTime: visit.checkInTime.toISOString(),
      checkOutTime: visit.checkOutTime?.toISOString() ?? null,
      status: visit.status,
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

  const labelFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });

  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);

    const key = toLocalDateKey(date);

    return {
      date: key,
      label: labelFormat.format(date),
      count: counts.get(key) ?? 0,
    };
  });
}
