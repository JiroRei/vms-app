"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/toast";
import type { PurposeOptionRecord } from "@/lib/purposes";

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white";
const smallButtonClass =
  "min-h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";

/**
 * Add, rename, retire and reorder the purpose options.
 *
 * Every change is a request followed by `router.refresh()`, so the list on
 * screen is always the server's, not a local guess. The list is short and the
 * edits are deliberate — there is no case here for optimistic updates, and
 * getting the order wrong on screen would be worse than a moment's wait.
 */
export function PurposeOptionsManager({
  initialOptions,
}: {
  initialOptions: PurposeOptionRecord[];
}) {
  const router = useRouter();
  const showToast = useToast();

  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  /** The option being renamed, and the draft label for it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /** Shared request plumbing: returns the parsed body, or null on failure. */
  async function send(
    url: string,
    method: "POST" | "PATCH",
    body: unknown,
    fallbackError: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        showToast(
          data?.fieldErrors?.label ?? data?.error ?? fallbackError,
          "error",
        );
        return null;
      }

      return data ?? {};
    } catch {
      showToast("Network problem — please try again.", "error");
      return null;
    }
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const label = newLabel.trim();

    if (!label) {
      setAddError("Please enter a label.");
      return;
    }

    setAddError(null);
    setAdding(true);

    const data = await send(
      "/api/purposes",
      "POST",
      { label },
      "Could not add that purpose.",
    );

    setAdding(false);

    if (data) {
      setNewLabel("");
      showToast(`Added “${label}”`);
      router.refresh();
    }
  }

  async function saveLabel(option: PurposeOptionRecord) {
    const label = draftLabel.trim();

    if (!label || label === option.label) {
      setEditingId(null);
      return;
    }

    setBusyId(option.id);

    const data = await send(
      `/api/purposes/${option.id}`,
      "PATCH",
      { label },
      "Could not rename that purpose.",
    );

    setBusyId(null);

    if (data) {
      setEditingId(null);
      showToast(`Renamed to “${label}”`);
      router.refresh();
    }
  }

  async function toggleActive(option: PurposeOptionRecord) {
    setBusyId(option.id);

    const data = await send(
      `/api/purposes/${option.id}`,
      "PATCH",
      { isActive: !option.isActive },
      "Could not update that purpose.",
    );

    setBusyId(null);

    if (data) {
      showToast(
        option.isActive
          ? `“${option.label}” hidden from new visits`
          : `“${option.label}” is selectable again`,
      );
      router.refresh();
    }
  }

  async function move(option: PurposeOptionRecord, direction: "up" | "down") {
    setBusyId(option.id);

    const data = await send(
      `/api/purposes/${option.id}/move`,
      "POST",
      { direction },
      "Could not reorder that purpose.",
    );

    setBusyId(null);

    if (data) {
      router.refresh();
    }
  }

  const activeCount = initialOptions.filter((o) => o.isActive).length;

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-start gap-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="min-w-[12rem] flex-1">
          <label
            htmlFor="new-purpose"
            className="block text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            Add a purpose
          </label>
          <input
            id="new-purpose"
            name="label"
            type="text"
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
              if (addError) setAddError(null);
            }}
            placeholder="e.g. Site inspection"
            aria-invalid={Boolean(addError)}
            className={`mt-1 ${inputClass}`}
          />
          {addError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {addError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={adding}
          className="mt-6 min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-gray-900 dark:text-white">
          {activeCount}
        </span>{" "}
        {activeCount === 1 ? "option" : "options"} offered to visitors
        {initialOptions.length > activeCount && (
          <> · {initialOptions.length - activeCount} hidden</>
        )}
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
              <th scope="col" className="px-4 py-3">
                Purpose
              </th>
              <th scope="col" className="w-28 px-4 py-3">
                Shown
              </th>
              <th scope="col" className="w-56 px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {initialOptions.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                  colSpan={3}
                >
                  No purpose options yet — add the first one above.
                </td>
              </tr>
            ) : (
              initialOptions.map((option, index) => {
                const busy = busyId === option.id;
                const editing = editingId === option.id;

                return (
                  <tr
                    key={option.id}
                    className={
                      option.isActive ? "" : "bg-gray-50/60 dark:bg-gray-900/30"
                    }
                  >
                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          type="text"
                          value={draftLabel}
                          autoFocus
                          onChange={(event) =>
                            setDraftLabel(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveLabel(option);
                            }
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          aria-label={`Rename ${option.label}`}
                          className={inputClass}
                        />
                      ) : (
                        <span
                          className={
                            option.isActive
                              ? "font-medium text-gray-900 dark:text-white"
                              : "font-medium text-gray-400 line-through dark:text-gray-500"
                          }
                        >
                          {option.label}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {option.isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-green-500"
                            aria-hidden
                          />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          Hidden
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => move(option, "up")}
                          disabled={busy || index === 0}
                          aria-label={`Move ${option.label} up`}
                          className={smallButtonClass}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => move(option, "down")}
                          disabled={busy || index === initialOptions.length - 1}
                          aria-label={`Move ${option.label} down`}
                          className={smallButtonClass}
                        >
                          ↓
                        </button>

                        {editing ? (
                          <button
                            type="button"
                            onClick={() => saveLabel(option)}
                            disabled={busy}
                            className={smallButtonClass}
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(option.id);
                              setDraftLabel(option.label);
                            }}
                            disabled={busy}
                            className={smallButtonClass}
                          >
                            Rename
                          </button>
                        )}

                        {/* Retire, never delete: visits already recorded
                            against this option have to keep displaying it. */}
                        <button
                          type="button"
                          onClick={() => toggleActive(option)}
                          disabled={busy}
                          className={smallButtonClass}
                        >
                          {option.isActive ? "Hide" : "Show"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Hiding an option removes it from the kiosk and booking dropdowns. Visits
        already recorded against it keep showing it, which is why there is no
        delete.
      </p>
    </div>
  );
}
