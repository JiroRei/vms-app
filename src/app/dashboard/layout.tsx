import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardNavigation } from "@/components/dashboard-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToastProvider } from "@/components/toast";
import { signOut } from "@/app/login/actions";
import { countExpectedToday } from "@/lib/appointments";
import { getSession } from "@/lib/session";
import { ORGANIZATION_NAME } from "@/lib/site-config";
import { KioskMonitor } from "./kiosk-monitor";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const expectedToday = await countExpectedToday().catch(() => 0);

  return (
    <div className="dashboard-shell flex min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <aside className="print-hidden sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-gray-200 bg-white px-4 py-5 md:flex dark:border-gray-800 dark:bg-gray-900">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-sm font-bold text-white" aria-hidden="true">V</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-950 dark:text-white">{ORGANIZATION_NAME}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">Visitor management</span>
          </span>
        </Link>
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Workspace</p>
        <DashboardNavigation role={session.role} expectedToday={expectedToday} />
        <div className="mt-auto space-y-4 border-t border-gray-200 pt-4 dark:border-gray-800">
          <Link href="/dashboard/account" className="block">
            <p className="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white">{session.name}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{session.role === "ADMIN" ? "Administrator" : "Guard"}</p>
          </Link>
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <form action={signOut}><button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white">Sign out</button></form>
          </div>
        </div>
      </aside>
      <div className="dashboard-content flex min-w-0 flex-1 flex-col">
        <header className="print-hidden border-b border-gray-200 bg-white md:hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/dashboard" className="truncate pr-3 text-sm font-semibold text-gray-950 dark:text-white">{ORGANIZATION_NAME}</Link>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/dashboard/account" className="rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Account</Link>
              <ThemeToggle />
              <form action={signOut}><button type="submit" className="rounded-lg px-2 py-2 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">Sign out</button></form>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-gray-100 px-2 py-2 dark:border-gray-800">
            <DashboardNavigation role={session.role} expectedToday={expectedToday} compact />
          </div>
        </header>
        <ToastProvider>
          <KioskMonitor admin={session.role === "ADMIN"} />
          <main className="mx-auto w-full max-w-screen-2xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </ToastProvider>
      </div>
    </div>
  );
}
