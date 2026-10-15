import { requireAdmin } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff";
import { loadStaffAccounts } from "@/lib/staff-data";

import { StaffDirectory } from "./staff-directory";

export default async function StaffPage() {
  // The API enforces the same rule; hiding the sidebar link is not the control.
  const session = await requireAdmin();
  const staff = await loadStaffAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Staff
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Who can sign in to this dashboard
        </p>
      </div>

      <StaffDirectory
        staff={staff}
        currentUserId={session.userId}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />
    </div>
  );
}
