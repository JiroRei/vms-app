import Link from "next/link";

import { getHosts } from "@/lib/visits";

import { DeliveryForm } from "./delivery-form";

// Departments are read per request so a newly added host shows up without a rebuild.
export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const hosts = await getHosts();

  return (
    // `min-h-dvh`, not `min-h-screen`: `100vh` counts the mobile address bar
    // and pushes the submit button below the fold. The vertical padding stops
    // `justify-center` clipping a tall form on a short screen.
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <DeliveryForm hosts={hosts} />

        <div className="text-center">
          <Link
            href="/kiosk"
            className="inline-block px-4 py-2 text-base text-gray-500 transition-colors hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
