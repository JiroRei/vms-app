import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="text-center space-y-8">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
          Visitor Management System
        </h1>
        <p className="mx-auto max-w-md text-lg text-gray-500 dark:text-gray-400">
          Streamline your visitor check-in process
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/kiosk"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
          >
            Kiosk Check-in
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Staff Login
          </Link>
        </div>
      </div>
    </div>
  );
}
