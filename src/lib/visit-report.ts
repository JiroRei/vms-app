import type { CheckInMethod, VisitStatus } from "@/generated/prisma/enums";
import { toDateTimeLocalInZone } from "@/lib/booking-config";

export function reportTimestamp(date: Date): string {
  return toDateTimeLocalInZone(date).replace("T", " ");
}

export function reportStatus(visit: { closedAutomatically: boolean; status: VisitStatus }): string {
  if (visit.closedAutomatically) return "auto-closed";
  if (visit.status === "CHECKED_OUT") return "checked out";
  if (visit.status === "PENDING_RETURN") return "out and returning";
  return "still on site";
}

export function reportCheckInMethod(visit: {
  checkedInBy: string | null;
  checkInMethod: CheckInMethod | null;
  appointment: { referenceNumber: string } | null;
}): string {
  if (visit.checkedInBy || visit.checkInMethod === "DELIVERY") return "guard-assisted";
  if (visit.checkInMethod === "PASS") return "pass";
  if (visit.checkInMethod === "APPOINTMENT" || visit.appointment) return "appointment QR";
  return "walk-in";
}

/** Quote every field, retaining commas, quotes and embedded newlines. */
export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map((cell) => {
    let value = String(cell ?? "");
    // Include leading whitespace/control characters Excel may ignore.
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(value)) value = `'${value}`;
    value = value.replace(/\r\n|\r|\n/g, "\r\n");
    return `"${value.replace(/"/g, '""')}"`;
  }).join(",") + "\r\n";
}
