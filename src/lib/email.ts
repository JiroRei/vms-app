import "server-only";

import { sendEmail } from "@/lib/email-outbox";
export { sendEmail } from "@/lib/email-outbox";
import { reportError } from "@/lib/logger";

import { renderPassQrPng } from "@/lib/pass-token";
import { renderQrPng } from "@/lib/qr";
import { SITE_TIMEZONE } from "@/lib/site-config";

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
  /** The signed "Manage this appointment" link. See `manageUrl()`. */
  manageUrl: string;
};

/**
 * Which appointment email this is. All three carry the details, the QR code and
 * the manage link; they differ in the headline and in what they say about
 * earlier emails.
 *
 * - `confirmed`: the first email for a booking.
 * - `updated`: the time changed. Earlier emails' times are outdated, but the
 *   QR code is the same one and keeps working.
 * - `new-code`: staff regenerated the QR code. Earlier codes and links are dead.
 */
export type AppointmentEmailKind = "confirmed" | "updated" | "new-code";

/**
 * Whether an email went out. Never an exception: the caller has already made
 * its change by the time this runs, and a mail outage must not undo a booking
 * — or a reschedule, or a cancellation — the visitor was told succeeded.
 */
export type EmailResult =
  | { sent: true }
  | { sent: false; reason: "failed" };

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * "Thursday, October 15, 2026 at 3:00 PM" on the building's clock — not the
 * server's, which need not be in the same zone as the building.
 */
const whenFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIMEZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatWhen(date: Date): string {
  return whenFormatter.format(date);
}

/** Free text from a public form reaches an HTML email, so escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY: Record<
  AppointmentEmailKind,
  { subject: (when: string) => string; title: string; intro: string; notice: string | null }
> = {
  confirmed: {
    subject: (when) => `Your visit on ${when}`,
    title: "Your visit is confirmed",
    intro: "here is everything you need to check in.",
    notice: null,
  },
  updated: {
    subject: (when) => `Appointment updated: now ${when}`,
    title: "Your appointment has been updated",
    intro: "your visit has a new time. The details below replace the earlier ones.",
    notice:
      "Times in earlier emails about this appointment are now outdated. Your QR code and reference number have not changed and still work.",
  },
  "new-code": {
    subject: (when) => `New check-in code for your visit on ${when}`,
    title: "Your visit has a new QR code",
    intro: "we have issued a new check-in code for your visit.",
    notice:
      "The QR code and links in earlier emails no longer work. Use the code in this email. Your reference number has not changed.",
  },
};

function detailRows(input: {
  scheduledFor: Date;
  hostName: string;
  hostDepartment: string;
  purposeLabel: string | null;
}): string {
  const purpose = input.purposeLabel
    ? escapeHtml(truncate(input.purposeLabel, PURPOSE_PREVIEW_LENGTH))
    : null;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;">When</td>
              <td style="padding:6px 0;text-align:right;font-weight:bold;">${escapeHtml(formatWhen(input.scheduledFor))}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Host</td>
              <td style="padding:6px 0;text-align:right;">${escapeHtml(input.hostName)}<br />
                <span style="color:#6b7280;font-size:12px;">${escapeHtml(input.hostDepartment)}</span>
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
          </table>`;
}

function shell(content: string): string {
  // Table-based and inline-styled: email clients are not browsers, and this has
  // to survive Outlook as well as a phone.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      ${content}
    </table>
  </body>
</html>`;
}

function buildHtml(input: AppointmentEmailInput, kind: AppointmentEmailKind): string {
  const copy = COPY[kind];
  const reference = escapeHtml(input.referenceNumber);
  const link = escapeHtml(input.manageUrl);

  return shell(`<tr>
        <td style="padding:24px 24px 8px;">
          <h1 style="margin:0;font-size:20px;">${copy.title}</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#6b7280;">
            Hello ${escapeHtml(input.firstName)}, ${copy.intro}
          </p>
          ${
            copy.notice
              ? `<p style="margin:12px 0 0;padding:10px 12px;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;">${copy.notice}</p>`
              : ""
          }
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;">
          ${detailRows(input)}
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
        <td style="padding:16px 24px 8px;">
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
      <tr>
        <td align="center" style="padding:8px 24px 24px;">
          <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111827;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">
            Manage this appointment
          </a>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
            View, reschedule or cancel. This link is personal to you — please don't forward it.
          </p>
        </td>
      </tr>`);
}

function buildText(input: AppointmentEmailInput, kind: AppointmentEmailKind): string {
  const copy = COPY[kind];

  return [
    `Hello ${input.firstName},`,
    "",
    `${copy.title}.`,
    ...(copy.notice ? ["", copy.notice] : []),
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
    "",
    "Manage this appointment (view, reschedule or cancel):",
    input.manageUrl,
  ].join("\n");
}


/** Sends staff password recovery links without revealing whether an account exists. */
export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  url: string;
}): Promise<void> {
  try {
    const name = escapeHtml(input.name);
    const url = escapeHtml(input.url);
    await sendEmail({ kind: "password-reset", expiresAt: new Date(Date.now() + 3_600_000),
      to: input.email,
      subject: "Reset your staff account password",
      html: shell(`<tr><td style="padding:24px;font-size:14px;">
        <h1 style="margin:0 0 12px;font-size:20px;">Reset your password</h1>
        <p>Hello ${name}, use the link below to choose a new password. The link expires after one hour.</p>
        <p style="margin:20px 0;"><a href="${url}" style="background:#2563eb;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;">Reset password</a></p>
        <p style="color:#6b7280;">If you did not request this, you can ignore this email.</p>
      </td></tr>`),
      text: `Hello ${input.name},\n\nReset your password using this link (valid for one hour):\n${input.url}\n\nIf you did not request this, you can ignore this email.`,
    });
  } catch (error) {
    await reportError(error, { operation: "sendPasswordResetEmail" });
    return;
  }
}

/** Notifies a host when a visitor checks in, if an arrival email is configured. */
export async function sendHostArrivalEmail(input: {
  email: string;
  hostName: string;
  visitorName: string;
  purpose: string | null;
  checkedInAt: Date;
}): Promise<EmailResult> {
  try {
    const hostName = escapeHtml(input.hostName);
    const visitorName = escapeHtml(input.visitorName);
    const when = escapeHtml(formatWhen(input.checkedInAt));
    const purpose = input.purpose ? `<p>Purpose: ${escapeHtml(input.purpose)}</p>` : "";
    return await sendEmail({ kind: "host-arrival",
      to: input.email,
      subject: `Visitor arrived: ${input.visitorName}`,
      html: shell(`<tr><td style="padding:24px;font-size:14px;">
        <h1 style="margin:0 0 12px;font-size:20px;">Visitor arrival</h1>
        <p>Hello ${hostName}, ${visitorName} has checked in.</p>
        <p>Time: ${when}</p>${purpose}
      </td></tr>`),
      text: `Hello ${input.hostName},\n\n${input.visitorName} has checked in.\nTime: ${formatWhen(input.checkedInAt)}${input.purpose ? `\nPurpose: ${input.purpose}` : ""}`,
    });
  } catch (error) {
    await reportError(error, { operation: "sendHostArrivalEmail" });
    return { sent: false, reason: "failed" };
  }
}

/**
 * Sends a confirmation, update or new-code email, and reports rather than
 * throws.
 *
 * Called after the change it describes is committed, so every failure here is
 * survivable: the booking stands and the reference number still checks the
 * visitor in. Delivery failures are retained in the outbox for retries.
 */
export async function sendAppointmentEmail(
  input: AppointmentEmailInput,
  kind: AppointmentEmailKind = "confirmed",
): Promise<EmailResult> {
  try {
    const qr = await renderQrPng(input.qrToken);
    return await sendEmail({ kind: `appointment-${kind}`,
      to: input.visitorEmail,
      subject: COPY[kind].subject(formatWhen(input.scheduledFor)),
      html: buildHtml(input, kind),
      text: buildText(input, kind),
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
  } catch (error) {
    await reportError(error, { operation: "sendAppointmentEmail" });
    return { sent: false, reason: "failed" };
  }
}

export type CancellationEmailInput = {
  firstName: string;
  visitorEmail: string;
  referenceNumber: string;
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  scheduledFor: Date;
  /** Who called it off, for the wording. */
  cancelledBy: "VISITOR" | "STAFF";
  reason: string | null;
};

/**
 * Tells the visitor an appointment is off. No QR code and no manage link: there
 * is nothing left to show or change. Same contract as `sendAppointmentEmail`.
 */
export async function sendAppointmentCancelledEmail(
  input: CancellationEmailInput,
): Promise<EmailResult> {
  try {
    const reason = input.reason;
    const who = input.cancelledBy === "VISITOR" ? "You cancelled this visit." : "Reception cancelled this visit.";
    return await sendEmail({ kind: "appointment-cancelled",
      to: input.visitorEmail,
      subject: `Appointment cancelled: ${formatWhen(input.scheduledFor)}`,
      html: shell(`<tr>
        <td style="padding:24px 24px 8px;">
          <h1 style="margin:0;font-size:20px;">Your appointment is cancelled</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#6b7280;">
            Hello ${escapeHtml(input.firstName)}, ${escapeHtml(who)}
            Its QR code and reference number ${escapeHtml(input.referenceNumber)} no longer work.
          </p>
          ${reason ? `<p style="margin:12px 0 0;font-size:14px;">${escapeHtml(reason)}</p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          ${detailRows(input)}
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
            If you still need to visit, please book again.
          </p>
        </td>
      </tr>`),
      text: [
        `Hello ${input.firstName},`,
        "",
        who,
        `Its QR code and reference number ${input.referenceNumber} no longer work.`,
        ...(reason ? ["", reason] : []),
        "",
        `When:    ${formatWhen(input.scheduledFor)}`,
        `Host:    ${input.hostName} (${input.hostDepartment})`,
        "",
        "If you still need to visit, please book again.",
      ].join("\n"),
    });
  } catch (error) {
    await reportError(error, { operation: "sendAppointmentCancelledEmail" });
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
  expiresAt?: Date;
};

/**
 * Sends a returning visitor their 6-digit booking verification code. Same
 * contract as `sendAppointmentEmail`: reports rather than throws.
 *
 * The expiration is copied from code issuance; retries cannot extend it.
 */
export async function sendVerificationCodeEmail(
  input: VerificationEmailInput,
): Promise<EmailResult> {
  try {
    const name = escapeHtml(input.firstName);
    const code = escapeHtml(input.code);
    return await sendEmail({ kind: "verification", expiresAt: input.expiresAt ?? new Date(Date.now() + input.validMinutes * 60_000),
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
  } catch (error) {
    await reportError(error, { operation: "sendVerificationCodeEmail" });
    return { sent: false, reason: "failed" };
  }
}

export type VisitorPassEmailInput = {
  firstName: string;
  visitorEmail: string;
  /** The pass token, `vp1.…`; never written to application logs. */
  token: string;
  expiresAt: Date;
  /** `issued` for a new pass; `replaced` after a rotate (the old QR is dead). */
  kind: "issued" | "replaced";
};

const PASS_QR_CONTENT_ID = "visitor-pass-qr";

const passDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIMEZONE,
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * Sends a visitor their pass: the QR inline, and how to use it. Same contract
 * as `sendAppointmentEmail`: reports rather than throws, and the issuance it
 * follows stands either way — the visitor can also see the pass by signing in
 * on the manage page. Missing mail settings retain it in the outbox for retry.
 */
export async function sendVisitorPassEmail(
  input: VisitorPassEmailInput,
): Promise<EmailResult> {
  try {
    const title = input.kind === "issued" ? "Your visitor pass" : "Your replacement visitor pass";
    const replacedNote = input.kind === "replaced" ? "Your previous pass no longer works. Use this one from now on." : null;
    const validUntil = passDateFormatter.format(input.expiresAt);
    const qr = await renderPassQrPng(input.token);
    return await sendEmail({ kind: `visitor-pass-${input.kind}`,
      to: input.visitorEmail,
      subject: title,
      html: shell(`<tr>
        <td style="padding:24px 24px 8px;">
          <h1 style="margin:0;font-size:20px;">${title}</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#6b7280;">
            Hello ${escapeHtml(input.firstName)}, thanks for visiting us regularly.
          </p>
          ${replacedNote ? `<p style="margin:12px 0 0;padding:10px 12px;font-size:13px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;">${replacedNote}</p>` : ""}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:16px 24px 0;">
          <img src="cid:${PASS_QR_CONTENT_ID}" width="220" height="220"
               alt="Your visitor pass QR code"
               style="display:block;border:1px solid #e5e7eb;border-radius:12px;" />
          <p style="margin:12px 0 0;font-size:15px;font-weight:bold;">
            Show this at the kiosk or gate to check in faster.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;font-size:12px;color:#6b7280;">
          It works for your appointments and for walk-in visits. Keep it to
          yourself: anyone holding this code can check in as you. It stays valid
          while you keep visiting (currently until ${escapeHtml(validUntil)}).
        </td>
      </tr>`),
      text: [
        `Hello ${input.firstName},`,
        "",
        `${title}.`,
        ...(replacedNote ? ["", replacedNote] : []),
        "",
        "Show this at the kiosk or gate to check in faster.",
        "The QR code is attached. It works for your appointments and for walk-in",
        "visits. Keep it to yourself: anyone holding it can check in as you.",
        `It stays valid while you keep visiting (currently until ${validUntil}).`,
      ].join("\n"),
      attachments: [
        {
          filename: "visitor-pass.png",
          content: qr,
          contentType: "image/png",
          contentId: PASS_QR_CONTENT_ID,
        },
      ],
    });
  } catch (error) {
    await reportError(error, { operation: "sendVisitorPassEmail" });
    return { sent: false, reason: "failed" };
  }
}
