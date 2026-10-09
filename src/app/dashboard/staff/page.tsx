import { redirect } from "next/navigation";

import { Role } from "@/generated/prisma/enums";
import { getSession } from "@/lib/session";
import { listStaff, MIN_PASSWORD_LENGTH } from "@/lib/staff";

import { StaffDirectory } from "./staff-directory";

export default async function StaffPage() {
  const session = await getSession();

  // The layout has established there is a session; this is the role gate. The
  // API enforces it too — neither this nor the hidden sidebar link is the
  // control.
  if (session?.role !== Role.ADMIN) {
    redirect("/dashboard");
  }

  const staff = await listStaff();

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
