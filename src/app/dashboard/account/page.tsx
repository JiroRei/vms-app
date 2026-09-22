import { getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff";

import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPage() {
  // The session guard lives in `src/app/dashboard/layout.tsx`. No role gate
  // here: changing your own password is everyone's business, and the route it
  // posts to takes the identity from the session rather than the request.
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Your account
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {session?.email} · {session?.role === "ADMIN" ? "Administrator" : "Guard"}
        </p>
      </div>

      <ChangePasswordForm minPasswordLength={MIN_PASSWORD_LENGTH} />
    </div>
  );
}
