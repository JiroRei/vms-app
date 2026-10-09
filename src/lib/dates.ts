/**
 * Date and time helpers, all in the runtime's local time zone.
 *
 * The app treats "a day" as the building's own day rather than UTC — a
 * single-site VMS cares about the local calendar. Keeping both the day
 * boundaries and the display formatting in one place stops the history filters,
 * the frequency chart, the live list and the stale-visit cleanup from drifting
 * apart on where a day starts and on how a timestamp reads.
 *
 * Nothing here imports `server-only`: the boundary helpers run in server code
 * and the formatters run on both sides of the RSC boundary.
 */

// ---------------------------------------------------------------------------
// Day boundaries
// ---------------------------------------------------------------------------

/** Local-time `YYYY-MM-DD`, avoiding the UTC shift `toISOString()` would add. */
export function toLocalDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Local-time `YYYY-MM-DDTHH:mm`, the value format a `datetime-local` input
 * wants.
 *
 * Local rather than `toISOString().slice(0, 16)` for the same reason as
 * `toLocalDateKey()` above: the input reads and writes wall-clock time, and the
 * booking API parses what comes back with `new Date("YYYY-MM-DDTHH:mm")`, which
 * is also local. A UTC value here would shift the field by the server's offset —
 * east of Greenwich that hands the picker a `min` already hours in the past.
 */
export function toDateTimeLocalValue(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
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

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * The locale is pinned rather than left to the runtime.
 *
 * Passing `[]` to `toLocaleString` resolves to whatever locale the browser or
 * the server happens to run in, so the same visit could read `9/15/26, 2:30 PM`
 * on one screen and `15/09/2026, 14:30` on another. Pinning it makes every
 * surface agree and makes the hydration text match the server's.
 *
 * The time *zone* is still the runtime's own. Server-rendered cells therefore
 * carry `suppressHydrationWarning`, since a guard's phone may sit in a
 * different zone than the server.
 */
const LOCALE = "en-US";

/** Shown wherever a value is missing or unparseable. */
export const EMPTY_VALUE = "—";

/** `02:30 PM` — same clock everywhere, so times line up in `tabular-nums`. */
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
});

/** `Sep 15` — axis ticks and other space-constrained labels. */
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
});

/** `Sep 15, 2026` — a date on its own, where the year still matters. */
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** `Sep 15, 02:30 PM` — the table format for a timestamp. */
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Accepts both sides of the RSC boundary: a `Date` in server code, the ISO
 * string it becomes once serialized into a client prop or an API response.
 */
export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function format(formatter: Intl.DateTimeFormat, value: DateInput): string {
  const date = toDate(value);
  return date ? formatter.format(date) : EMPTY_VALUE;
}

/** `02:30 PM` */
export function formatTime(value: DateInput): string {
  return format(timeFormat, value);
}

/** `Sep 15` */
export function formatShortDate(value: DateInput): string {
  return format(shortDateFormat, value);
}

/** `Sep 15, 2026` */
export function formatDate(value: DateInput): string {
  return format(dateFormat, value);
}

/** `Sep 15, 02:30 PM` */
export function formatDateTime(value: DateInput): string {
  return format(dateTimeFormat, value);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a visit lasted, as `45m`, `2h 15m` or `1d 3h`.
 *
 * Two units at most: a guard scanning a column wants the magnitude, not the
 * seconds. Anything under a minute reads `<1m` rather than `0m`, so a visitor
 * who checked straight back out doesn't look like a formatting bug.
 */
export function formatDuration(from: DateInput, to: DateInput): string {
  const start = toDate(from);
  const end = toDate(to);

  if (!start || !end) {
    return EMPTY_VALUE;
  }

  const elapsed = end.getTime() - start.getTime();

  // A clock change or a hand-edited record can put the end before the start;
  // report it as unknown rather than rendering a negative stay.
  if (elapsed < 0) {
    return EMPTY_VALUE;
  }

  if (elapsed < MINUTE_MS) {
    return "<1m";
  }

  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }

  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    const minutes = Math.floor((elapsed % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(elapsed / DAY_MS);
  const hours = Math.floor((elapsed % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
