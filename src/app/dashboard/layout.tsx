import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/app/login/actions";
import { getDevSession } from "@/lib/dev-auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TEMP: dev-only auth, replace with Better Auth call
  // (`auth.api.getSession({ headers: await headers() })`).
  const session = await getDevSession();

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
            href="/dashboard/history"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Visit History
          </Link>
        </nav>
        <div className="mt-6 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <div>
            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
              {session.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {session.role}
            </p>
          </div>
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
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 md:hidden dark:border-gray-700 dark:bg-gray-800">
          <Link
            href="/dashboard"
            className="text-lg font-bold text-gray-900 dark:text-white"
          >
            VMS Dashboard
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex gap-4">
              <Link
                href="/dashboard"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Live
              </Link>
              <Link
                href="/dashboard/history"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                History
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
