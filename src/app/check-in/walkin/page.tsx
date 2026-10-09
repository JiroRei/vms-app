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
    // `min-h-dvh`, not `min-h-screen`: `100vh` counts the mobile address bar
    // and pushes the submit button below the fold. The vertical padding stops
    // `justify-center` clipping a tall form on a short screen.
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <WalkinForm hosts={hosts} purposes={purposes} />

        <div className="text-center">
          <Link
            href="/check-in"
            className="inline-block px-4 py-2 text-base text-gray-500 transition-colors hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
