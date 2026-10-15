import { requireAdmin } from "@/lib/session";
import { loadHostDirectory } from "@/lib/staff-data";

import { HostDirectory } from "./host-directory";

export default async function HostsPage() {
  // The API enforces the same rule; hiding the sidebar link is not the control.
  await requireAdmin();
  const hosts = await loadHostDirectory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Hosts
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Who visitors can ask for at the kiosk
        </p>
      </div>

      <HostDirectory hosts={hosts} />
    </div>
  );
}
