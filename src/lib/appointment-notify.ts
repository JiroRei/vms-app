import "server-only";

import { manageUrl } from "@/lib/appointment-access";
import type { AppointmentDetail } from "@/lib/appointments";
import {
  sendAppointmentCancelledEmail,
  sendAppointmentEmail,
  type AppointmentEmailKind,
  type EmailResult,
} from "@/lib/email";

/**
 * The confirmation, update or new-code email for an appointment, with a fresh
 * manage link signed over its current QR token. Reports, never throws.
 */
export function emailAppointment(
  appointment: AppointmentDetail,
  baseUrl: string,
  kind: AppointmentEmailKind,
): Promise<EmailResult> {
  return sendAppointmentEmail(
    {
      firstName: appointment.firstName,
      visitorEmail: appointment.visitorEmail,
      referenceNumber: appointment.referenceNumber,
      qrToken: appointment.qrToken,
      purposeLabel: appointment.purposeLabel,
      hostName: appointment.hostName,
      hostDepartment: appointment.hostDepartment,
      scheduledFor: appointment.scheduledFor,
      manageUrl: manageUrl(baseUrl, appointment),
    },
    kind,
  );
}

/** The cancellation email. Reports, never throws. */
export function emailCancellation(
  appointment: AppointmentDetail,
): Promise<EmailResult> {
  return sendAppointmentCancelledEmail({
    firstName: appointment.firstName,
    visitorEmail: appointment.visitorEmail,
    referenceNumber: appointment.referenceNumber,
    purposeLabel: appointment.purposeLabel,
    hostName: appointment.hostName,
    hostDepartment: appointment.hostDepartment,
    scheduledFor: appointment.scheduledFor,
    cancelledBy: appointment.cancelledBy ?? "STAFF",
    reason: appointment.cancelReason,
  });
}
