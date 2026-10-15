import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { VisitStatus, VisitorType } from "@/generated/prisma/enums";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { formatDateKey } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { sweepStaleVisitsIfDue } from "@/lib/stale-visits";

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
  /**
   * Who closed the visit, as their name read at the time.
   *
   * Null when no person is on record: either the stale-visit cleanup closed it
   * (see `closedAutomatically`, which is what says so) or it was checked out
   * before checkouts were attributed.
   */
  checkedOutByName: string | null;
  /**
   * The stale-visit cleanup closed this visit. `checkOutTime` is then the
   * configured auto-close time rather than a departure, so no time on site is
   * shown for it.
   */
  closedAutomatically: boolean;
};

export type HistoryFilters = {
  search: string;
  hostId: string;
  from: string;
  to: string;
  /** When true, DELIVERY rows are excluded from the table. */
  hideDeliveries: boolean;
  type: "" | VisitorType;
  page: number;
};

export type HistoryPage = {
  visits: HistoryVisit[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Site midnight, or the exclusive next midnight for an inclusive date range.
 * Impossible dates are ignored consistently by the history screen and export.
 */
function parseDateBoundary(value: string, edge: "start" | "end"): Date | null {
  try {
    return zonedTimeToUtc(edge === "end" ? addDaysToKey(value, 1) : value, "00:00");
  } catch {
    return null;
  }
}

export type HistoryParams = Record<string, string | string[] | undefined>;

/** Parse and build once for both the history screen and the CSV endpoint. */
export function getHistoryQuery(params: HistoryParams) {
  const read = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const rawType = read("type");
  const type = rawType === "GUEST" || rawType === "DELIVERY" ? rawType : "";
  const filters: HistoryFilters = {
    search: read("search").trim(),
    hostId: read("hostId"),
    from: parseDateBoundary(read("from"), "start") ? read("from") : "",
    to: parseDateBoundary(read("to"), "end") ? read("to") : "",
    type,
    hideDeliveries: !type && read("hideDeliveries") === "1",
    page: Math.max(1, Number.parseInt(read("page"), 10) || 1),
  };
  return { filters, where: buildWhere(filters) };
}

export function historyFilterParams(filters: HistoryFilters): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["search", "hostId", "from", "to", "type"] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  if (filters.hideDeliveries) query.set("hideDeliveries", "1");
  return query;
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

  if (filters.type || filters.hideDeliveries) {
    visitor.type = filters.type || "GUEST";
  }

  if (Object.keys(visitor).length > 0) {
    where.visitor = visitor;
  }

  const from = parseDateBoundary(filters.from, "start");
  const to = parseDateBoundary(filters.to, "end");

  if (from || to) {
    where.checkInTime = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {}),
    };
  }

  return where;
}

export async function getVisitHistory(
  { filters, where }: ReturnType<typeof getHistoryQuery>,
): Promise<HistoryPage> {
  // Close stale visits first (throttled) so none of this page still reads
  // "Still inside" for a visitor from a day that is over.
  await sweepStaleVisitsIfDue();

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
      checkedOutByName: visit.checkedOutByName,
      closedAutomatically: visit.closedAutomatically,
    })),
  };
}

export type FrequencyPoint = {
  /** `YYYY-MM-DD`, in the configured site time zone. */
  date: string;
  label: string;
  count: number;
};

/**
 * Visit counts per day for the last `days` days, inclusive of today.
 *
 * Aggregated in memory: the row count here is small, and date keys and
 * boundaries use the configured site time zone.
 * Days with no visits are returned as zeroes so the chart has no gaps.
 */
export async function getVisitorFrequency(
  days: number,
): Promise<FrequencyPoint[]> {
  const lastKey = dateKeyInZone(new Date());
  const firstKey = addDaysToKey(lastKey, -(days - 1));
  const start = zonedTimeToUtc(firstKey, "00:00");
  const end = zonedTimeToUtc(addDaysToKey(lastKey, 1), "00:00");

  const visits = await prisma.visit.findMany({
    where: { checkInTime: { gte: start, lt: end } },
    select: { checkInTime: true },
  });

  const counts = new Map<string, number>();

  for (const visit of visits) {
    const key = dateKeyInZone(visit.checkInTime);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: days }, (_, offset) => {
    const key = addDaysToKey(firstKey, offset);

    return {
      date: key,
      label: formatDateKey(key),
      count: counts.get(key) ?? 0,
    };
  });
}
