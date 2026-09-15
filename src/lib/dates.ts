/**
 * Day-boundary helpers, all in the server's local time zone.
 *
 * The app treats "a day" as the server's own day rather than UTC — a single-site
 * VMS cares about the building's calendar. Keeping these in one place stops the
 * history filters, the frequency chart and the stale-visit cleanup from drifting
 * apart on where a day starts and ends.
 */

/** Local-time `YYYY-MM-DD`, avoiding the UTC shift `toISOString()` would add. */
export function toLocalDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight at the start of the day `date` falls on. */
export function startOfLocalDay(date: Date = new Date()): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** The last representable millisecond of the day `date` falls on. */
export function endOfLocalDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
