import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="text-center space-y-8">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          Visitor Management System
        </h1>
        <p className="text-lg text-gray-500 max-w-md mx-auto">
          Streamline your visitor check-in process
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/check-in"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
          >
            Kiosk Check-in
          </Link>
          <Link
            href="/appointment-booking"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Book an appointment
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Staff Login
          </Link>
        </div>
      </div>
    </div>
  );
}
