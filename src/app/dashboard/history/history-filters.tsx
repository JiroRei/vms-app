"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { HostOption } from "@/lib/visits";

const controlClass =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";

export type FilterValues = {
  search: string;
  hostId: string;
  from: string;
  to: string;
  hideDeliveries: boolean;
};

/**
 * The URL is the source of truth for the filters. The page gives this component
 * a `key` derived from the active query string, so navigating (back, or a
 * pagination link) remounts it with fresh state instead of syncing in an effect.
 */
export function HistoryFilters({
  hosts,
  initial,
}: {
  hosts: HostOption[];
  initial: FilterValues;
}) {
  const router = useRouter();

  // The results are server-rendered, so the round trip is invisible without
  // this: the button would look dead for as long as the query takes. Inside a
  // transition the current table stays on screen and un-blanked until the new
  // one is ready, which is also what stops the page jumping.
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [hostId, setHostId] = useState(initial.hostId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [hideDeliveries, setHideDeliveries] = useState(initial.hideDeliveries);

  function navigate(href: string) {
    startTransition(() => router.push(href));
  }

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const params = new URLSearchParams();

    if (search.trim()) params.set("search", search.trim());
    if (hostId) params.set("hostId", hostId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (hideDeliveries) params.set("hideDeliveries", "1");
    // Any filter change invalidates the current page number.

    const query = params.toString();
    navigate(query ? `/dashboard/history?${query}` : "/dashboard/history");
  }

  function clear() {
    setSearch("");
    setHostId("");
    setFrom("");
    setTo("");
    setHideDeliveries(false);
    navigate("/dashboard/history");
  }

  const hasFilters = Boolean(search || hostId || from || to || hideDeliveries);

  return (
    <form
      onSubmit={apply}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_auto_auto_auto]"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="search"
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          Visitor name
        </label>
        <input
          id="search"
          name="search"
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name…"
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="hostId"
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          Host
        </label>
        <select
          id="hostId"
          name="hostId"
          value={hostId}
          onChange={(event) => setHostId(event.target.value)}
          className={controlClass}
        >
          <option value="">All hosts</option>
          {hosts.map((host) => (
            <option key={host.id} value={host.id}>
              {host.name} — {host.department}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="from"
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="to"
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
          className={controlClass}
        />
      </div>

      {/* `flex-wrap` and `sm:col-span-2`: on a phone this row holds a checkbox
          and two buttons that otherwise squeeze into unreadable slivers. */}
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-1">
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={hideDeliveries}
            onChange={(event) => setHideDeliveries(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
          />
          Hide deliveries
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {pending ? "Applying…" : "Apply"}
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
