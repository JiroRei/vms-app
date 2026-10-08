import Link from "next/link";

export default function KioskPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Welcome
          </h1>
          <p className="mt-2 text-gray-500">
            How would you like to check in?
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Link
            href="/check-in/appointment"
            className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-8 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
          >
            <span className="text-4xl mb-3">📋</span>
            <span className="text-xl font-semibold text-gray-900">
              I have an appointment
            </span>
            <span className="text-sm text-gray-500 mt-1">
              Check in with a pre-registered visit
            </span>
          </Link>

          <Link
            href="/check-in/walkin"
            className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-8 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
          >
            <span className="text-4xl mb-3">🚶</span>
            <span className="text-xl font-semibold text-gray-900">
              Walk-in
            </span>
            <span className="text-sm text-gray-500 mt-1">
              Register as a new visitor
            </span>
          </Link>
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
