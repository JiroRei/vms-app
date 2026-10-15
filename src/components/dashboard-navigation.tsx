"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; short: string; admin?: boolean };
const items: Item[] = [
  { href: "/dashboard", label: "Live check-ins", short: "Live" },
  { href: "/dashboard/appointments", label: "Expected arrivals", short: "Arrivals" },
  { href: "/dashboard/scan", label: "Scan QR", short: "Scan" },
  { href: "/dashboard/history", label: "Visit history", short: "History" },
  { href: "/dashboard/register", label: "Daily register", short: "Register" },
  { href: "/dashboard/roll-call", label: "Emergency roll-call", short: "Roll-call" },
  { href: "/dashboard/visitors", label: "Visitors & passes", short: "Visitors" },
  { href: "/dashboard/hosts", label: "Hosts", short: "Hosts", admin: true },
  { href: "/dashboard/staff", label: "Staff", short: "Staff", admin: true },
  { href: "/dashboard/email-log", label: "Email log", short: "Email", admin: true },
  { href: "/dashboard/settings/purposes", label: "Purpose options", short: "Purposes", admin: true },
];

function isCurrent(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNavigation({ role, expectedToday, compact = false }: {
  role: string;
  expectedToday: number;
  compact?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className={compact ? "flex min-w-max gap-1" : "space-y-1"}>
      {items.filter((item) => !item.admin || role === "ADMIN").map((item) => {
        const active = isCurrent(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={`${compact ? "shrink-0 px-3" : "flex w-full items-center justify-between px-3"} rounded-lg py-2 text-sm font-medium transition-colors ${active ? "bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200" : "text-gray-600 hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-700/70 dark:hover:text-white"}`}>
            <span>{compact ? item.short : item.label}</span>
            {item.href === "/dashboard/appointments" && expectedToday > 0 && !compact && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-teal-100 text-teal-800 dark:bg-teal-800 dark:text-teal-100" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`} aria-label={`${expectedToday} expected today`}>{expectedToday}</span>
            )}
            {item.href === "/dashboard/appointments" && expectedToday > 0 && compact && <span className="ml-1 text-xs">{expectedToday}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
