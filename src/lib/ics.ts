/**
 * A single-event iCalendar (.ics) file for "Add to calendar".
 *
 * Pure and dependency-free so the manage page can build the file in the
 * browser: no endpoint to authorize, and no token in a download URL. Times are
 * written in UTC (`…Z`), which every calendar app converts to its own zone.
 */

export type CalendarEvent = {
  /** Stable across downloads, so re-importing after a reschedule updates the entry. */
  uid: string;
  start: Date;
  durationMinutes: number;
  title: string;
  description: string;
  location?: string;
};

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 §3.1). */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;

  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }

  parts.push(rest);
  return parts.join("\r\n");
}

export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60_000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VMS//Visitor Management System//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(fold).join("\r\n")}\r\n`;
}
