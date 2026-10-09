import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { ToastProvider } from "@/components/toast";
import { signOut } from "@/app/login/actions";
import { getSession } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen dark:bg-gray-900">
      <aside className="w-56 border-r border-gray-200 bg-white p-4 hidden md:block dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-lg font-bold text-gray-900 dark:text-white"
          >
            VMS Dashboard
          </Link>
        </div>
        <nav className="space-y-1">
          <Link
            href="/dashboard"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Live Check-ins
          </Link>
          <Link
            href="/dashboard/scan"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Scan QR
          </Link>
          <Link
            href="/dashboard/appointments"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Appointments
          </Link>
          <Link
            href="/dashboard/history"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Visit History
          </Link>

          {/* Admin-only. Each page redirects a guard who reaches it anyway, and
              the APIs return 403 — hiding the links is convenience, not the
              control. */}
          {session.role === "ADMIN" && (
            <>
              <Link
                href="/dashboard/hosts"
                className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Hosts
              </Link>
              <Link
                href="/dashboard/staff"
                className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Staff
              </Link>
              <Link
                href="/dashboard/settings/purposes"
                className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Purpose Options
              </Link>
            </>
          )}
        </nav>
        <div className="mt-6 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link href="/dashboard/account" className="block">
            <p className="truncate text-sm font-medium text-gray-900 hover:underline dark:text-white">
              {session.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {session.role}
            </p>
          </Link>
          <ThemeToggle />
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden sm:px-6 dark:border-gray-700 dark:bg-gray-800">
          <Link
            href="/dashboard"
            className="text-lg font-bold text-gray-900 dark:text-white"
          >
            VMS Dashboard
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex gap-1">
              <Link
                href="/dashboard"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              >
                Live
              </Link>
              <Link
                href="/dashboard/scan"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Scan
              </Link>
              <Link
                href="/dashboard/history"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              >
                History
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        {/* Every dashboard action confirms itself through this, so it wraps
            the whole subtree rather than any one page. Narrower gutters on a
            phone: 24px each side is a lot of a 360px screen. */}
        <ToastProvider>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </ToastProvider>
      </div>
    </div>
  );
}
