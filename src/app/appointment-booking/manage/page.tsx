import type { Metadata } from "next";
import Link from "next/link";

import {
  readVisitorClaim,
  resolveManageToken,
} from "@/lib/appointment-access";
import {
  listVisitorAppointments,
  type AppointmentDetail,
} from "@/lib/appointments";
import { renderQrDataUrl } from "@/lib/qr";
import { getActivePass, passQrDataUrl } from "@/lib/visitor-pass";

import { ManageView, type ManagedAppointment, type MyPass } from "./manage-view";

// Read per request: it depends on the token, the cookie and the clock.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage your appointment",
  // The manage token sits in this page's URL; keep it out of Referer headers
  // when the visitor follows a link elsewhere.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Only what the visitor's own screen needs. The QR is rendered here, server
 * side, as an image — the raw token never reaches the browser as data.
 */
async function toManaged(
  appointment: AppointmentDetail,
  now: Date,
): Promise<ManagedAppointment> {
  const pending =
    appointment.status === "PENDING" &&
    appointment.expiresAt.getTime() > now.getTime();

  return {
    referenceNumber: appointment.referenceNumber,
    firstName: appointment.firstName,
    lastName: appointment.lastName,
    purposeLabel: appointment.purposeLabel,
    hostName: appointment.hostName,
    hostDepartment: appointment.hostDepartment,
    scheduledFor: appointment.scheduledFor.toISOString(),
    status: pending ? "PENDING" : appointment.status === "PENDING" ? "EXPIRED" : appointment.status,
    cancelledBy: appointment.cancelledBy,
    checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
    canReschedule:
      pending && appointment.scheduledFor.getTime() > now.getTime(),
    canCancel: pending,
    qrDataUrl: pending
      ? await renderQrDataUrl(appointment.qrToken).catch(() => null)
      : null,
  };
}

/**
 * /appointment-booking/manage — a visitor's own appointments.
 *
 * Two ways in (see `src/lib/appointment-access.ts`): the signed link from a
 * confirmation or update email, which opens that one appointment, or the
 * returning-visitor sign-in (emailed code), which lists all of theirs. Without
 * either, the page shows the sign-in form and nothing else.
 */
export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const now = new Date();

  let content: React.ReactNode;

  if (token) {
    const appointment = await resolveManageToken(token, now);

    content = appointment ? (
      <ManageView
        mode="link"
        token={token}
        appointments={[await toManaged(appointment, now)]}
      />
    ) : (
      <ManageView mode="invalid-link" token={null} appointments={[]} />
    );
  } else {
    const claim = await readVisitorClaim(now);

    // The pass is a credential for the whole profile, so it is shown only to a
    // visitor signed in with the emailed code — never via an appointment's
    // manage link, which is scoped to that one appointment.
    let myPass: MyPass | null = null;

    if (claim) {
      const pass = await getActivePass(claim.profileId);

      if (pass && pass.expiresAt.getTime() > now.getTime()) {
        myPass = {
          qrDataUrl: await passQrDataUrl(pass),
          expiresAt: pass.expiresAt.toISOString(),
          lastUsedAt: pass.lastUsedAt?.toISOString() ?? null,
        };
      }
    }

    content = claim ? (
      <ManageView
        mode="signed-in"
        token={null}
        email={claim.email}
        myPass={myPass}
        appointments={await Promise.all(
          (await listVisitorAppointments(claim, now)).map((appointment) =>
            toManaged(appointment, now),
          ),
        )}
      />
    ) : (
      <ManageView mode="sign-in" token={null} appointments={[]} />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-lg space-y-6">
        {content}

        <div className="flex justify-center gap-6 text-sm">
          <Link href="/appointment-booking" className="text-gray-600 hover:text-gray-900">
            Book a visit
          </Link>
          <Link href="/privacy" className="text-gray-600 hover:text-gray-900">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
