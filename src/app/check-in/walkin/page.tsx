import Link from "next/link";

import { getActivePurposeOptions } from "@/lib/purposes";
import { getHosts } from "@/lib/visits";

import { WalkinForm } from "./walkin-form";

// Hosts and purposes are read per request so an admin's edit shows up on the
// kiosk without a rebuild.
export const dynamic = "force-dynamic";

export default async function WalkinPage() {
  const [hosts, purposes] = await Promise.all([
    getHosts(),
    getActivePurposeOptions(),
  ]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <WalkinForm hosts={hosts} purposes={purposes} />

        <div className="text-center">
          <Link
            href="/check-in"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
