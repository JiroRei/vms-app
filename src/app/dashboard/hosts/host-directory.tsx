"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import type { HostRecord } from "@/lib/hosts";

const controlClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorClass = "mt-1 text-sm text-red-600 dark:text-red-400";
const smallButtonClass =
  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const neutralButtonClass = `${smallButtonClass} border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700`;

type FieldErrors = { name?: string; department?: string };

export function HostDirectory({ hosts }: { hosts: HostRecord[] }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** The host whose row is currently in edit mode, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDepartment, setEditDepartment] = useState("");

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const activeCount = hosts.filter((host) => host.active).length;

  function clearError(field: keyof FieldErrors) {
    setFormError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "Please enter the host's name.";
    if (!department.trim()) errors.department = "Please enter their department.";

    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      document.getElementById(errors.name ? "name" : "department")?.focus();
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          department: department.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
        } else {
          setFormError(data?.error ?? "Could not add this host.");
        }

        return;
      }

      setName("");
      setDepartment("");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditing(host: HostRecord) {
    setEditingId(host.id);
    setEditName(host.name);
    setEditDepartment(host.department);
    setRowError(null);
  }

  async function patchHost(
    id: string,
    body: { name?: string; department?: string; active?: boolean },
  ) {
    setPendingId(id);
    setRowError(null);

    try {
      const response = await fetch(`/api/hosts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const fieldMessage =
          data?.fieldErrors?.name ?? data?.fieldErrors?.department;
        setRowError(fieldMessage ?? data?.error ?? "Could not update this host.");
        return;
      }

      setEditingId(null);
      router.refresh();
    } catch {
      setRowError("Could not reach the server. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Add ----------------------------------------------------------- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Add a host
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Anyone added here becomes selectable at the kiosk.
        </p>

        <form onSubmit={handleCreate} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className={labelClass}>
                Name
              </label>
              <input
                id="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
                className={controlClass}
                placeholder="Jeffrey E."
                autoComplete="off"
              />
              {fieldErrors.name && (
                <p className={errorClass}>{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="department" className={labelClass}>
                Department
              </label>
              <input
                id="department"
                value={department}
                onChange={(event) => {
                  setDepartment(event.target.value);
                  clearError("department");
                }}
                className={controlClass}
                placeholder="Human Resources"
                autoComplete="off"
              />
              {fieldErrors.department && (
                <p className={errorClass}>{fieldErrors.department}</p>
              )}
            </div>
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {submitting ? "Adding…" : "Add host"}
          </button>
        </form>
      </div>

      {/* Directory ------------------------------------------------------ */}
      <div className="space-y-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {activeCount} active
          {hosts.length > activeCount &&
            `, ${hosts.length - activeCount} inactive`}
        </p>

        {rowError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {rowError}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {hosts.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No hosts yet"
              hint="Add someone above. Until at least one host exists, the walk-in kiosk has nobody to offer and a visitor cannot finish checking in."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Host
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Department
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      History
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {hosts.map((host) => {
                    const editing = editingId === host.id;
                    const busy = pendingId === host.id;

                    return (
                      <tr
                        key={host.id}
                        className={host.active ? undefined : "opacity-60"}
                      >
                        <td className="px-4 py-3">
                          {editing ? (
                            <input
                              value={editName}
                              onChange={(event) =>
                                setEditName(event.target.value)
                              }
                              className={controlClass}
                              aria-label="Host name"
                            />
                          ) : (
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {host.name}
                              {!host.active && (
                                <span className="ml-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                  Inactive
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editing ? (
                            <input
                              value={editDepartment}
                              onChange={(event) =>
                                setEditDepartment(event.target.value)
                              }
                              className={controlClass}
                              aria-label="Department"
                            />
                          ) : (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {host.department}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {host.visitorCount} visitor
                          {host.visitorCount === 1 ? "" : "s"}
                          {host.openAppointments > 0 && (
                            <>
                              {" · "}
                              <span className="text-amber-700 dark:text-amber-400">
                                {host.openAppointments} waiting
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void patchHost(host.id, {
                                      name: editName,
                                      department: editDepartment,
                                    })
                                  }
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                                >
                                  {busy ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setEditingId(null)}
                                  className={neutralButtonClass}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => startEditing(host)}
                                  className={neutralButtonClass}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void patchHost(host.id, {
                                      active: !host.active,
                                    })
                                  }
                                  className={neutralButtonClass}
                                  title={
                                    host.active
                                      ? "Removes them from the kiosk. Their visit history is kept."
                                      : "Puts them back on the kiosk."
                                  }
                                >
                                  {busy
                                    ? "Working…"
                                    : host.active
                                      ? "Deactivate"
                                      : "Reactivate"}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Hosts are never deleted — deactivating takes them off the kiosk and
          keeps every visit they are named in.
        </p>
      </div>
    </div>
  );
}
