/**
 * When a visit may be booked from the public booking page, and the arithmetic
 * that applies those rules.
 *
 * Shared by the date/time picker and `POST /api/appointments`, so the slots a
 * visitor is offered and the slots the server accepts can never disagree. Pure
 * on purpose — no `server-only`, no database — and every function that depends
 * on the current moment takes it as an argument rather than calling
 * `new Date()` itself. The picker computes "now" after mount (see
 * `useCurrentMinute` in the booking form); the server computes its own per
 * request.
 *
 * All wall-clock values here — date keys and `HH:mm` times — are in
 * `BOOKING_TIMEZONE`, the building's clock, regardless of where the server or
 * the visitor's browser happens to be. Instants (`Date`) are UTC as always.
 */

/** The building's time zone. Slots are shown and validated in this zone. */
export const BOOKING_TIMEZONE = "Asia/Manila";

/** How the picker names that zone to visitors. */
export const BOOKING_TIMEZONE_LABEL = "Philippine time (UTC+8)";

/** First slot of the day starts here (`HH:mm`). */
export const BUSINESS_HOURS_START = "08:00";

/** The last slot must end by here (`HH:mm`), so the last start is 16:30. */
export const BUSINESS_HOURS_END = "17:00";

/** Length of one bookable slot. */
export const SLOT_MINUTES = 30;

/** How far ahead a visit may be booked, counting today as day 0. */
export const MAX_DAYS_AHEAD = 30;

/** A calendar day in `BOOKING_TIMEZONE`, as `YYYY-MM-DD`. */
export type DateKey = string;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(total: number): string {
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Every slot start in a day, e.g. `["08:00", "08:30", …, "16:30"]`. */
export const SLOT_TIMES: readonly string[] = (() => {
  const times: string[] = [];
  const end = toMinutes(BUSINESS_HOURS_END);

  for (
    let start = toMinutes(BUSINESS_HOURS_START);
    start + SLOT_MINUTES <= end;
    start += SLOT_MINUTES
  ) {
    times.push(fromMinutes(start));
  }

  return times;
})();

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BOOKING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The calendar day `instant` falls on in `BOOKING_TIMEZONE`. */
export function dateKeyInZone(instant: Date): DateKey {
  // en-CA formats as YYYY-MM-DD.
  return dateKeyFormatter.format(instant);
}

function parseDateKey(key: string): [number, number, number] | null {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Round-trip through UTC to reject impossible dates like 2026-02-31.
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

/** `key` plus `days` calendar days. Pure date arithmetic, no zone involved. */
export function addDaysToKey(key: DateKey, days: number): DateKey {
  const parts = parseDateKey(key);
  if (!parts) throw new Error(`Invalid date key: ${key}`);

  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

/** How far `BOOKING_TIMEZONE` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date): number {
  const values: Record<string, number> = {};

  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the clock in `BOOKING_TIMEZONE` reads `time` on
 * `dateKey`. Manila has no DST, but the second pass keeps this correct if the
 * zone is ever changed to one that does.
 */
export function zonedTimeToUtc(dateKey: DateKey, time: string): Date {
  const parts = parseDateKey(dateKey);
  if (!parts || !TIME_PATTERN.test(time)) {
    throw new Error(`Invalid wall-clock time: ${dateKey} ${time}`);
  }

  const minutes = toMinutes(time);
  const wallAsUtc = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    Math.floor(minutes / 60),
    minutes % 60,
  );

  let guess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc));
  guess = wallAsUtc - zoneOffsetMs(new Date(guess));

  return new Date(guess);
}

/** The slots on `dateKey` that still start after `now`. */
export function availableSlots(dateKey: DateKey, now: Date): string[] {
  const { first, last } = bookableRange(now);
  if (dateKey < first || dateKey > last) return [];

  return SLOT_TIMES.filter(
    (time) => zonedTimeToUtc(dateKey, time).getTime() > now.getTime(),
  );
}

/**
 * The first and last bookable days, inclusive. Today is skipped once its last
 * slot has started, so the calendar never offers a day with nothing on it.
 */
export function bookableRange(now: Date): { first: DateKey; last: DateKey } {
  const today = dateKeyInZone(now);
  const lastSlotToday = zonedTimeToUtc(today, SLOT_TIMES[SLOT_TIMES.length - 1]);

  return {
    first: lastSlotToday.getTime() > now.getTime() ? today : addDaysToKey(today, 1),
    last: addDaysToKey(today, MAX_DAYS_AHEAD),
  };
}

/** `YYYY-MM-DDTHH:mm`, the wire format for a chosen slot. */
export function toSlotValue(dateKey: DateKey, time: string): string {
  return `${dateKey}T${time}`;
}

export type SlotCheck =
  | { ok: true; scheduledFor: Date }
  | { ok: false; error: string };

/**
 * The server's re-check of a submitted slot: a real date and time, on a slot
 * boundary within business hours, inside the booking window, and still in the
 * future. Returns the UTC instant to store.
 */
export function checkSlot(value: string, now: Date): SlotCheck {
  const [dateKey, time] = value.split("T");

  if (!dateKey || !time || !parseDateKey(dateKey) || !TIME_PATTERN.test(time)) {
    return { ok: false, error: "Please choose a date and time." };
  }

  if (!SLOT_TIMES.includes(time)) {
    return {
      ok: false,
      error: `Please choose one of the listed times between ${BUSINESS_HOURS_START} and ${BUSINESS_HOURS_END}.`,
    };
  }

  const { last } = bookableRange(now);
  const scheduledFor = zonedTimeToUtc(dateKey, time);

  if (scheduledFor.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: "That time has already passed. Please choose a later slot.",
    };
  }

  if (dateKey > last) {
    return {
      ok: false,
      error: `Visits can be booked up to ${MAX_DAYS_AHEAD} days ahead.`,
    };
  }

  return { ok: true, scheduledFor };
}

const dateKeyLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * "Thursday, October 8, 2026". Formatted as a UTC date because a key is a bare
 * calendar day — this way the output is the same on the server, in any
 * browser, and at any moment.
 */
export function formatDateKey(key: DateKey): string {
  const parts = parseDateKey(key);
  if (!parts) return key;

  return dateKeyLabelFormatter.format(
    new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])),
  );
}

/** "08:30" → "8:30 AM". */
export function formatSlotTime(time: string): string {
  const minutes = toMinutes(time);
  const hours = Math.floor(minutes / 60);
  const suffix = hours < 12 ? "AM" : "PM";

  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}
