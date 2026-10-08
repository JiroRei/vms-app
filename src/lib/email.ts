import "server-only";

import { Resend } from "resend";

import { renderQrPng } from "@/lib/qr";

/**
 * The inline attachment's content id, referenced from the HTML as `cid:`. An
 * attachment rather than a hosted image on purpose: a visitor arriving at a
 * building with no signal still needs the code to render, and most mail clients
 * block remote images by default anyway.
 */
const QR_CONTENT_ID = "appointment-qr";

/**
 * Purpose labels are admin-managed and normally short, but nothing stops an
 * admin writing a sentence, and the backfill turned some long free-text values
 * into options. The email shows a readable slice either way.
 */
const PURPOSE_PREVIEW_LENGTH = 120;

export type AppointmentEmailInput = {
  /** Greeted by first name only. */
  firstName: string;
  visitorEmail: string;
  referenceNumber: string;
  qrToken: string;
  /** Null when the booking carries no purpose; the row is simply left out. */
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  scheduledFor: Date;
};

/**
 * Whether the confirmation email went out. Never an exception: the caller has
 * already created the appointment by the time this runs, and a mail outage must
 * not undo a booking the visitor was told succeeded.
 */
export type EmailResult =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "failed" };

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function formatWhen(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Free text from a public form reaches an HTML email, so escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(input: AppointmentEmailInput): string {
  const name = escapeHtml(input.firstName);
  const purpose = input.purposeLabel
    ? escapeHtml(truncate(input.purposeLabel, PURPOSE_PREVIEW_LENGTH))
    : null;
  const host = escapeHtml(input.hostName);
  const department = escapeHtml(input.hostDepartment);
  const reference = escapeHtml(input.referenceNumber);
  const when = escapeHtml(formatWhen(input.scheduledFor));

  // Table-based and inline-styled: email clients are not browsers, and this has
  // to survive Outlook as well as a phone.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <h1 style="margin:0;font-size:20px;">Your visit is confirmed</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#6b7280;">
            Hello ${name}, here is everything you need to check in.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;">When</td>
              <td style="padding:6px 0;text-align:right;font-weight:bold;">${when}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Host</td>
              <td style="padding:6px 0;text-align:right;">${host}<br />
                <span style="color:#6b7280;font-size:12px;">${department}</span>
              </td>
            </tr>
            ${
              purpose
                ? `<tr>
              <td style="padding:6px 0;color:#6b7280;">Purpose</td>
              <td style="padding:6px 0;text-align:right;">${purpose}</td>
            </tr>`
                : ""
            }
          </table>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:8px 24px 0;">
          <img src="cid:${QR_CONTENT_ID}" width="220" height="220"
               alt="QR code for appointment ${reference}"
               style="display:block;border:1px solid #e5e7eb;border-radius:12px;" />
          <p style="margin:12px 0 0;font-size:13px;color:#6b7280;">
            Show this code at the kiosk or to the guard on arrival.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">
              If the code will not scan
            </p>
            <p style="margin:6px 0 0;font-size:20px;font-weight:bold;letter-spacing:2px;">
              ${reference}
            </p>
            <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
              Type this reference number at the kiosk instead.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(input: AppointmentEmailInput): string {
  return [
    `Hello ${input.firstName},`,
    "",
    "Your visit is confirmed.",
    "",
    `When:    ${formatWhen(input.scheduledFor)}`,
    `Host:    ${input.hostName} (${input.hostDepartment})`,
    ...(input.purposeLabel
      ? [`Purpose: ${truncate(input.purposeLabel, PURPOSE_PREVIEW_LENGTH)}`]
      : []),
    "",
    `Reference number: ${input.referenceNumber}`,
    "",
    "A QR code is attached to this email. Show it at the kiosk or to the",
    "guard on arrival, or type the reference number above instead.",
  ].join("\n");
}

/**
 * Sends the confirmation email, and reports rather than throws.
 *
 * Called after the appointment row exists, so every failure here is survivable:
 * the booking stands and the reference number on the confirmation screen still
 * checks the visitor in. That is why the screen shows the number at all.
 */
export async function sendAppointmentEmail(
  input: AppointmentEmailInput,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.APPOINTMENT_FROM_EMAIL;

  if (!apiKey || !from) {
    // The expected state on a dev box with no mail credentials. Logged at info
    // rather than error so it does not read as a fault.
    console.info(
      `[email] RESEND_API_KEY/APPOINTMENT_FROM_EMAIL not set — skipping confirmation for ${input.referenceNumber}`,
    );
    return { sent: false, reason: "not-configured" };
  }

  try {
    const qr = await renderQrPng(input.qrToken);
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from,
      to: input.visitorEmail,
      subject: `Your visit on ${formatWhen(input.scheduledFor)}`,
      html: buildHtml(input),
      text: buildText(input),
      attachments: [
        {
          filename: `${input.referenceNumber}.png`,
          content: qr,
          contentType: "image/png",
          // Makes it inline, so `cid:` in the HTML resolves to it.
          contentId: QR_CONTENT_ID,
        },
      ],
    });

    if (error) {
      console.error(
        `[email] Resend rejected the confirmation for ${input.referenceNumber}`,
        error,
      );
      return { sent: false, reason: "failed" };
    }

    return { sent: true };
  } catch (cause) {
    console.error(
      `[email] Could not send the confirmation for ${input.referenceNumber}`,
      cause,
    );
    return { sent: false, reason: "failed" };
  }
}

export type VerificationEmailInput = {
  /** Greeted by first name only. */
  firstName: string;
  visitorEmail: string;
  code: string;
  /** How long the code stays valid, for the wording. */
  validMinutes: number;
};

/**
 * Sends a returning visitor their 6-digit booking verification code. Same
 * contract as `sendAppointmentEmail`: reports rather than throws.
 *
 * Outside production the code is also written to the server console, so the
 * flow can be exercised on a dev box with no mail credentials.
 */
export async function sendVerificationCodeEmail(
  input: VerificationEmailInput,
): Promise<EmailResult> {
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[email] Booking verification code for ${input.visitorEmail}: ${input.code}`,
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.APPOINTMENT_FROM_EMAIL;

  if (!apiKey || !from) {
    console.info(
      "[email] RESEND_API_KEY/APPOINTMENT_FROM_EMAIL not set — skipping verification code email",
    );
    return { sent: false, reason: "not-configured" };
  }

  const name = escapeHtml(input.firstName);
  const code = escapeHtml(input.code);

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: input.visitorEmail,
      subject: `Your booking code is ${input.code}`,
      html: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:24px;">
          <p style="margin:0;font-size:14px;">Hello ${name},</p>
          <p style="margin:12px 0 0;font-size:14px;color:#6b7280;">
            Enter this code on the booking page to use your saved details:
          </p>
          <p style="margin:16px 0;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;">
            ${code}
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;">
            It expires in ${input.validMinutes} minutes. If you did not ask for
            this, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      text: [
        `Hello ${input.firstName},`,
        "",
        `Your booking verification code is ${input.code}.`,
        `It expires in ${input.validMinutes} minutes.`,
        "",
        "If you did not ask for this, you can ignore this email.",
      ].join("\n"),
    });

    if (error) {
      console.error("[email] Resend rejected the verification code email", error);
      return { sent: false, reason: "failed" };
    }

    return { sent: true };
  } catch (cause) {
    console.error("[email] Could not send the verification code email", cause);
    return { sent: false, reason: "failed" };
  }
}
