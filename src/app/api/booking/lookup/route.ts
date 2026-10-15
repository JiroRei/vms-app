import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import {
  CODE_TTL_MS,
  issueVerificationCode,
} from "@/lib/booking-verification";
import { sendVerificationCodeEmail } from "@/lib/email";
import { parseNameParts } from "@/lib/names";
import { VERIFICATION_EMAIL_LIMIT, VERIFICATION_IP_LIMIT } from "@/lib/booking-config";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";
import { getClientIp } from "@/lib/client-ip";

const MAX_EMAIL = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * POST /api/booking/lookup — start the returning-visitor flow by emailing a
 * 6-digit code to `email`, if that email + `firstName`/`lastName` pair is a
 * visitor profile. A code is issued for that exact pair and only works with it.
 *
 * The response is identical whether or not a profile exists, and the email is
 * sent after the response goes out (`after()`), so neither the body nor the
 * timing says who has visited. The rate limit (429) also applies to every
 * address alike — see `issueVerificationCode()`.
 */
async function POSTHandler(request: Request) {
  const limit = await consumeDatabaseRateLimit(`verification-lookup:${getClientIp(request.headers)}`, VERIFICATION_IP_LIMIT);
  if (!limit.allowed) return NextResponse.json({ error: "Too many code requests. Please wait 15 minutes and try again." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const value = typeof fields.email === "string" ? fields.email.trim() : "";
  const name = parseNameParts(fields);

  const fieldErrors: Record<string, string> = name.ok ? {} : { ...name.errors };

  if (!value || value.length > MAX_EMAIL || !EMAIL_PATTERN.test(value)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!name.ok || Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  // Per address as well as per caller, so rotating addresses cannot flood one
  // inbox with codes (KNOWN_ISSUES M-01).
  const emailLimit = await consumeDatabaseRateLimit(`verification-lookup-email:${value.toLowerCase()}`, VERIFICATION_EMAIL_LIMIT);
  if (!emailLimit.allowed) return NextResponse.json({ error: "Too many codes requested for this email. Please wait 15 minutes and try again." }, { status: 429, headers: { "Retry-After": String(emailLimit.retryAfter) } });

  try {
    const result = await issueVerificationCode({
      email: value,
      firstName: name.firstName,
      lastName: name.lastName,
    });

    if (result.status === "rate-limited") {
      return NextResponse.json(
        {
          error:
            "Too many codes requested for this email. Please wait a few minutes and try again.",
        },
        { status: 429 },
      );
    }

    const { delivery } = result;

    if (delivery) {
      after(() =>
        sendVerificationCodeEmail({
          firstName: delivery.firstName,
          visitorEmail: value,
          code: delivery.code,
          validMinutes: CODE_TTL_MS / 60_000,
          expiresAt: delivery.expiresAt,
        }),
      );
    }

    return NextResponse.json({
      message:
        "If we have a record for this email and name, we've sent a code.",
    });
  } catch (error) {
    logger.error("POST /api/booking/lookup failed", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
