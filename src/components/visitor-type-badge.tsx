import type { VisitorType } from "@/generated/prisma/enums";

/**
 * Marks courier drop-offs in the visit tables.
 *
 * Only DELIVERY is badged — guests are the overwhelming majority, so badging
 * them too would add noise to every row without adding information. The badge
 * is violet rather than amber/red on purpose: this is a category, not a status,
 * and the status colors stay reserved for actual warnings.
 */
export function VisitorTypeBadge({ type }: { type: VisitorType }) {
  if (type !== "DELIVERY") {
    return null;
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 align-middle text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
      <span aria-hidden>📦</span>
      Delivery
    </span>
  );
}
