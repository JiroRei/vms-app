"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Stage = "idle" | "confirming" | "working";

export function CloseStaleVisits() {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("idle");
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Counts first, so the dialog can name a number instead of asking blind. */
  async function openDialog() {
    setError(null);
    setSummary(null);
    setStaleCount(null);
    setStage("confirming");

    try {
      const response = await fetch("/api/visits/close-stale", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = (await response.json()) as { staleCount: number };
      setStaleCount(data.staleCount);
    } catch {
      setError("Could not check for stale visits.");
      setStage("idle");
    }
  }

  async function confirm() {
    setStage("working");
    setError(null);

    try {
      const response = await fetch("/api/visits/close-stale", {
        method: "POST",
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "Could not close stale visits.");
        setStage("idle");
        return;
      }

      const closed = data.closed as number;
      setSummary(
        closed === 0
          ? "No stale visits to close."
          : `Closed ${closed} stale ${closed === 1 ? "visit" : "visits"}.`,
      );
      setStage("idle");
      // Drop the closed rows out of the live list.
      router.refresh();
    } catch {
      setError("Network problem — could not close stale visits.");
      setStage("idle");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={openDialog}
        disabled={stage !== "idle"}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        Close all stale visits
      </button>

      {summary && (
        <p
          role="status"
          className="text-xs font-medium text-green-700 dark:text-green-400"
        >
          {summary}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {(stage === "confirming" || stage === "working") && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-stale-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h2
                id="close-stale-title"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                Close all stale visits?
              </h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {staleCount === null
                  ? "Checking…"
                  : staleCount === 0
                    ? "There are no visits left open from a previous day."
                    : `${staleCount} ${staleCount === 1 ? "visit is" : "visits are"} still open from a previous day. Each will be checked out at the end of the day it started.`}
              </p>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                This cannot be undone.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStage("idle")}
                disabled={stage === "working"}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={stage === "working" || !staleCount}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {stage === "working" ? "Closing…" : "Close them"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
