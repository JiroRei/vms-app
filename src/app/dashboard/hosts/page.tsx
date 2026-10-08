import { redirect } from "next/navigation";

import { listHosts } from "@/lib/hosts";
import { getSession } from "@/lib/session";

import { HostDirectory } from "./host-directory";

export default async function HostsPage() {
  const session = await getSession();

  // The layout has already established there *is* a session; this is the role
  // gate. The API enforces it too — the sidebar hiding the link is not the
  // control, and neither is this.
  if (session?.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const hosts = await listHosts();

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
