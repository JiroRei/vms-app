"use client";
import { apiErrorMessage } from "@/lib/api-error-message";


import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/components/toast";
import { formatZonedDate } from "@/lib/booking-config";
import { formatFullName } from "@/lib/names";
import type { StaffProfileRow } from "@/lib/visitor-pass";

const smallButton =
  "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const neutralButton = `${smallButton} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700`;

type Action = "issue" | "send" | "revoke" | "rotate";

function PassBadge({ row }: { row: StaffProfileRow }) {
  const pass = row.pass;

  if (!pass) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">No pass</span>;
  }

  const styles = {
    ACTIVE: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
    EXPIRED: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    REVOKED: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  }[pass.state];
  const label = { ACTIVE: "Active", EXPIRED: "Expired", REVOKED: "Revoked" }[pass.state];

  return (
    <div>
      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>
        {label}
        {pass.state === "ACTIVE" && pass.version > 1 ? ` · v${pass.version}` : ""}
      </span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">
        {pass.state === "REVOKED" && pass.revokedAt
          ? `Revoked ${formatZonedDate(new Date(pass.revokedAt))}`
          : pass.lastUsedAt
            ? `Last used ${formatZonedDate(new Date(pass.lastUsedAt))}`
            : pass.issueReason === "RECURRING_AUTO"
              ? "Issued automatically"
              : "Issued by staff"}
      </span>
    </div>
  );
}

/**
 * The visitor profile list: search and pass actions. Every action
 * goes to the server and the list is re-read from it afterwards.
 */
export function VisitorDirectory({
  profiles,
  query,
  limit,
}: {
  profiles: StaffProfileRow[];
  query: string;
  limit: number;
}) {
  const router = useRouter();
  const showToast = useToast();
  const [search, setSearch] = useState(query);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: Action } | null>(null);

  async function run(row: StaffProfileRow, action: Action) {
    setBusyId(row.id);

    try {
      const response = await fetch(`/api/visitors/${encodeURIComponent(row.id)}/pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => null)) ?? {};

      if (!response.ok) {
        showToast(apiErrorMessage(data.error) ?? "That did not work.", "error");
        return;
      }

      const name = formatFullName(row.firstName, row.lastName);
      const emailed = data.emailSent
        ? " and emailed"
        : data.emailQueued
          ? " (email queued for delivery)"
          : " (the email could not be sent)";
      showToast(
        action === "issue"
          ? `Pass issued to ${name}${emailed}.`
          : action === "rotate"
            ? `New pass code for ${name}${emailed}. The old QR no longer works.`
            : action === "send"
              ? `Pass for ${name}${emailed}.`
              : `${name}'s pass is revoked.`,
      );
      setConfirming(null);
    } catch {
      showToast("Could not reach the server. Please try again.", "error");
    } finally {
      setBusyId(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const q = search.trim();
          router.push(q ? `/dashboard/visitors?q=${encodeURIComponent(q)}` : "/dashboard/visitors");
        }}
      >
        <input
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or email"
          aria-label="Search visitors by name or email"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-72 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button type="submit" className={neutralButton}>
          Search
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {profiles.length === 0 ? (
          <EmptyState
            title={query ? "No visitors match" : "No visitor profiles yet"}
            hint={query ? undefined : "Profiles are created when someone books a visit."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
                  <th scope="col" className="px-4 py-3">Visitor</th>
                  <th scope="col" className="px-4 py-3">Visits</th>
                  <th scope="col" className="px-4 py-3">Recurring since</th>
                  <th scope="col" className="px-4 py-3">Pass</th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {profiles.map((row) => {
                  const busy = busyId === row.id;
                  const active = row.pass?.state === "ACTIVE";
                  const confirm = confirming?.id === row.id ? confirming.action : null;

                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-gray-900 dark:text-white">
                          {formatFullName(row.firstName, row.lastName)}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{row.email}</span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-700 dark:text-gray-200">{row.visitCount}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                        {row.recurringSince ? formatZonedDate(new Date(row.recurringSince)) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <PassBadge row={row} />
                      </td>
                      <td className="px-4 py-3">
                        {confirm ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <span className="text-xs text-gray-600 dark:text-gray-300">
                              {confirm === "revoke" ? "Their QR stops working for good." : "Their current QR stops working."}
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(row, confirm)}
                              className={`${smallButton} border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300`}
                            >
                              {busy ? "Working…" : confirm === "revoke" ? "Yes, revoke" : "Yes, rotate"}
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} className={neutralButton}>
                              Back
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {!active && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(row, "issue")}
                                className={`${smallButton} border-blue-600 bg-blue-600 text-white hover:bg-blue-500`}
                              >
                                {busy ? "Issuing…" : "Issue pass"}
                              </button>
                            )}
                            {active && (
                              <>
                                <button type="button" disabled={busy} onClick={() => void run(row, "send")} className={neutralButton}>
                                  Send QR
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirming({ id: row.id, action: "rotate" })}
                                  className={neutralButton}
                                >
                                  Rotate and resend
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirming({ id: row.id, action: "revoke" })}
                                  className={neutralButton}
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {profiles.length === limit && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing the first {limit}. Search to narrow the list.
        </p>
      )}
    </div>
  );
}
