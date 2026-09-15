import Link from "next/link";

import { getHosts } from "@/lib/visits";

import { DeliveryForm } from "./delivery-form";

// Departments are read per request so a newly added host shows up without a rebuild.
export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const hosts = await getHosts();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <DeliveryForm hosts={hosts} />

        <div className="text-center">
          <Link
            href="/kiosk"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to kiosk
          </Link>
        </div>
      </div>
    </div>
  );
}
