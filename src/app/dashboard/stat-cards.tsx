"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { SkeletonLine } from "@/components/table-skeleton";
import type { DashboardStats } from "@/lib/dashboard-stats-types";

/** Same cadence as the live list, so the two numbers move together. */
const POLL_INTERVAL_MS = 5000;

const CARD_CLASS =
  "group flex min-h-28 flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-700 dark:hover:bg-gray-700/40 dark:focus:ring-offset-gray-950";

const NUMBER_CLASS = "text-2xl font-bold tabular-nums text-gray-900 dark:text-white";

const LABEL_CLASS = "text-sm font-medium text-gray-600 dark:text-gray-300";

const MUTED_CLASS = "text-xs text-gray-400 dark:text-gray-500";

/** The quoted targets a stat card can scroll to. */
const LIVE_LIST_ID = "live-check-ins";
const RETURNING_SELECTOR = '[data-returning-row="true"]';

/**
 * The five summary numbers across the top of the dashboard.
 *
 * Polls its own endpoint rather than taking server-rendered values, so the
 * counts stay in step with the live list below without a full page refresh.
 * While the first response is in flight each card is a skeleton of the same
 * size, and a failure leaves the last known numbers in place with a quiet
 * note — the guard can keep working from the list underneath.
 */
export function StatCards({ todayKey }: { todayKey: string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const response = await fetch("/api/dashboard/stats", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = (await response.json()) as { stats: DashboardStats };
      setStats(data.stats);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // Deferred like the kiosk monitor's first fetch: kicking a setState-touching
    // call straight off the effect body is what the hooks lint forbids.
    const initial = setTimeout(() => void refresh(), 0);

    const interval = setInterval(() => {
      // Skip polling a backgrounded tab; it refreshes once visible again.
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  /** Scrolls to the live list, preferring the first returning row when asked. */
  function scrollToLiveList(event: React.MouseEvent<HTMLAnchorElement>, returning = false) {
    const row = returning
      ? document.querySelector<HTMLElement>(RETURNING_SELECTOR)
      : null;
    const target = row ?? document.getElementById(LIVE_LIST_ID);

    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: row ? "center" : "start" });
  }

  const value = (field: keyof DashboardStats) => {
    if (stats) return <span className={NUMBER_CLASS}>{stats[field]}</span>;
    if (error) {
      return (
        <span className={`${NUMBER_CLASS} text-gray-300 dark:text-gray-600`} aria-hidden>
          —
        </span>
      );
    }
    return <SkeletonLine className="h-8 w-10" />;
  };

  const stillExpectedSecondary =
    stats !== null ? (
      <span className={MUTED_CLASS}>of {stats.appointmentsBookedToday} booked</span>
    ) : error ? null : (
      <SkeletonLine className="h-3 w-16" />
    );

  return (
    <section aria-label="Today at a glance" className="space-y-1">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <a
          href={`#${LIVE_LIST_ID}`}
          onClick={(event) => scrollToLiveList(event)}
          className={CARD_CLASS}
          aria-label={`${stats?.onSite ?? 0} visitors on site now — view live check-ins`}
        >
          {value("onSite")}
          <span className={LABEL_CLASS}>On site now</span>
        </a>

        <a
          href={`#${LIVE_LIST_ID}`}
          onClick={(event) => scrollToLiveList(event, true)}
          className={CARD_CLASS}
          aria-label={`${stats?.outReturning ?? 0} visitors out and returning — view live check-ins`}
        >
          {value("outReturning")}
          <span className={LABEL_CLASS}>Out, returning</span>
        </a>

        <Link
          href={`/dashboard/history?type=GUEST&from=${todayKey}&to=${todayKey}`}
          className={CARD_CLASS}
          aria-label={`${stats?.visitorsToday ?? 0} visitors checked in today — view history`}
        >
          {value("visitorsToday")}
          <span className={LABEL_CLASS}>Visitors today</span>
        </Link>

        <Link
          href={`/dashboard/history?type=DELIVERY&from=${todayKey}&to=${todayKey}`}
          className={CARD_CLASS}
          aria-label={`${stats?.deliveriesToday ?? 0} deliveries logged today — view history`}
        >
          {value("deliveriesToday")}
          <span className={LABEL_CLASS}>Deliveries today</span>
        </Link>

        <Link
          href="/dashboard/appointments"
          className={`${CARD_CLASS} col-span-2 lg:col-span-1`}
          aria-label={
            stats
              ? `${stats.appointmentsStillExpected} appointments still expected today, of ${stats.appointmentsBookedToday} booked — view appointments`
              : "Appointments still expected today — view appointments"
          }
        >
          <span className="flex flex-col">
            {value("appointmentsStillExpected")}
            {stillExpectedSecondary}
          </span>
          <span className={LABEL_CLASS}>Still expected</span>
        </Link>
      </div>

      {/* Fixed height so the note appearing never nudges the page. */}
      <p
        role="status"
        className="h-4 text-right text-xs font-medium text-amber-600 dark:text-amber-400"
      >
        {error ? "Live stats paused — retrying…" : ""}
      </p>
    </section>
  );
}
