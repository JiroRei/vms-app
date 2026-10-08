import Link from "next/link";

/** The three ways in, in the order a visitor is most likely to need them. */
const OPTIONS = [
  {
    href: "/kiosk/appointment",
    icon: "📋",
    label: "I have an appointment",
    hint: "Check in with a pre-registered visit",
  },
  {
    href: "/kiosk/walkin",
    icon: "🚶",
    label: "Walk-in",
    hint: "Register as a new visitor",
  },
  {
    href: "/kiosk/delivery",
    icon: "📦",
    label: "Delivery / Courier",
    hint: "Dropping off a package",
  },
] as const;

export default function KioskPage() {
  return (
    // `min-h-dvh`, not `min-h-screen`: `100vh` counts the mobile address bar,
    // which would push the third option below the fold on a phone.
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Welcome
          </h1>
          <p className="mt-2 text-base text-gray-500">
            How would you like to check in?
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {OPTIONS.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              // Padding scales down on a phone so all three cards, the heading
              // and the back link still fit without scrolling.
              className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-blue-300 hover:shadow-md sm:p-8"
            >
              <span className="mb-3 text-4xl" aria-hidden>
                {option.icon}
              </span>
              <span className="text-center text-lg font-semibold text-gray-900 sm:text-xl">
                {option.label}
              </span>
              <span className="mt-1 text-center text-sm text-gray-500">
                {option.hint}
              </span>
            </Link>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block px-4 py-2 text-base text-gray-500 transition-colors hover:text-gray-700"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
