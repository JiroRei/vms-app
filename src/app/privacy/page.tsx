import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Visitor Management System",
};

/**
 * PLACEHOLDER privacy notice linked from the booking form's consent checkbox.
 * The wording below is a scaffold, not legal text: every section marked
 * "Placeholder" must be replaced by the organization before go-live.
 */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1 font-medium text-amber-900">
      {children}
    </span>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex justify-center px-4 py-10">
      <article className="w-full max-w-2xl space-y-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Privacy Policy
          </h1>
          <p
            role="note"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
          >
            <strong>Placeholder text.</strong> This notice has not been reviewed
            and does not yet describe the organization&rsquo;s actual practices.
            Replace every highlighted section before this system goes live.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            What we collect
          </h2>
          <p className="text-gray-700">
            When you book or check in for a visit, we collect:
          </p>
          <ul className="list-disc space-y-1 pl-6 text-gray-700">
            <li>your name;</li>
            <li>your email address;</li>
            <li>your phone number, if you give one;</li>
            <li>
              visit records: who or what you visited, the purpose, the booked
              date and time, and when you checked in and out.
            </li>
          </ul>
          <p className="text-gray-700">
            If you use &ldquo;I&rsquo;ve been here before&rdquo;, your email is
            used to find your previous visit records and send you a one-time
            code. <Placeholder>Placeholder: any further detail.</Placeholder>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Why we use it</h2>
          <p className="text-gray-700">
            To log visitors and keep the site secure: to confirm your booking,
            send your QR code, check you in and out, and know who is on the
            premises.{" "}
            <Placeholder>
              Placeholder: legal basis for processing and any other purposes.
            </Placeholder>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Who can see it
          </h2>
          <p className="text-gray-700">
            Reception and security staff who use this system.{" "}
            <Placeholder>
              Placeholder: administrators, service providers (e.g. email
              delivery, hosting), and any other recipients.
            </Placeholder>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            How long we keep it
          </h2>
          <p className="text-gray-700">
            <Placeholder>
              Placeholder: retention period for visitor profiles and visit
              records, and how they are deleted.
            </Placeholder>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Your rights and contact
          </h2>
          <p className="text-gray-700">
            <Placeholder>
              Placeholder: how to access, correct or delete your data, and who
              to contact (e.g. the Data Protection Officer).
            </Placeholder>
          </p>
        </section>

        <footer className="border-t border-gray-200 pt-6 text-sm">
          <Link
            href="/appointment-booking"
            className="font-medium text-accent hover:underline"
          >
            Back to booking
          </Link>
        </footer>
      </article>
    </div>
  );
}
