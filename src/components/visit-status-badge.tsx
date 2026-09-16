import type { VisitStatus } from "@/generated/prisma/enums";

/**
 * Marks visits whose visitor is out of the building but expected back.
 *
 * Only PENDING_RETURN is badged, on the same reasoning as `VisitorTypeBadge`:
 * ACTIVE is the norm in the live list and CHECKED_OUT never appears there, so
 * badging either would add a label to every row without adding information.
 *
 * Amber rather than violet on purpose — this one *is* a status, and it is the
 * case a guard needs to spot at a glance when the building is being emptied.
 */
export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  if (status !== "PENDING_RETURN") {
    return null;
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
      Out — Returning
    </span>
  );
}
