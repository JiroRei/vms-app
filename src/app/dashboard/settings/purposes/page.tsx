// TODO(multi-tenancy): this list is currently global across all users of the app. Once multi-tenancy exists, scope create/list/update here by the admin's organizationId, or a second organization editing this list will affect every other organization's dropdown.

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";
import { getPurposeOptions } from "@/lib/purposes";

import { PurposeOptionsManager } from "./purpose-options-manager";

// The list changes from this very page, so it is never cached.
export const dynamic = "force-dynamic";

export default async function PurposesSettingsPage() {
  // The dashboard layout has already rejected anyone without a session; this
  // narrows that to admins. The API enforces the same rule — hiding the page is
  // not the control.
  const session = await getSession();

  if (session?.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const options = await getPurposeOptions();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Purpose options
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          What visitors can choose from on the kiosk and the booking page. Order
          here is the order they see.
        </p>
      </div>

      <PurposeOptionsManager initialOptions={options} />

      <div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Back to live check-ins
        </Link>
      </div>
    </div>
  );
}
