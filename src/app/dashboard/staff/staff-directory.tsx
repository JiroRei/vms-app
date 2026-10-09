"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatShortDate } from "@/lib/dates";
import type { StaffMember } from "@/lib/staff";

const controlClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorClass = "mt-1 text-sm text-red-600 dark:text-red-400";
const neutralButtonClass =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";

type FieldErrors = Partial<
  Record<"email" | "name" | "password" | "role", string>
>;

export function StaffDirectory({
  staff,
  currentUserId,
  minPasswordLength,
}: {
  staff: StaffMember[];
  /** Used to stop someone deleting or demoting the account they are using. */
  currentUserId: string;
  minPasswordLength: number;
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "GUARD">("GUARD");
  const [password, setPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const adminCount = staff.filter((member) => member.role === "ADMIN").length;

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

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          role,
          password,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
        } else {
          setFormError(data?.error ?? "Could not create this account.");
        }

        return;
      }

      setCreated(email.trim());
      setEmail("");
      setName("");
      setPassword("");
      setRole("GUARD");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeRole(member: StaffMember) {
    const nextRole = member.role === "ADMIN" ? "GUARD" : "ADMIN";

    setPendingId(member.id);
    setRowError(null);

    try {
      const response = await fetch(`/api/staff/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setRowError(data?.error ?? "Could not change that role.");
        return;
      }

      router.refresh();
    } catch {
      setRowError("Could not reach the server. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function removeStaff(id: string) {
    setPendingId(id);
    setRowError(null);

    try {
      const response = await fetch(`/api/staff/${id}`, { method: "DELETE" });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setRowError(data?.error ?? "Could not remove that account.");
        return;
      }

      router.refresh();
    } catch {
      setRowError("Could not reach the server. Please try again.");
    } finally {
      setPendingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Create -------------------------------------------------------- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Add a staff login
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          There is no public sign-up. This is the only way an account is made.
        </p>

        {created && (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 dark:border-green-500/40 dark:bg-green-500/10">
            <p className="text-sm text-green-900 dark:text-green-200">
              <strong>{created}</strong> can sign in now. Give them the password
              you set and ask them to change it from their account page.
            </p>
          </div>
        )}

        <form onSubmit={handleCreate} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearError("email");
                }}
                className={controlClass}
                placeholder="guard@geoplan.ph"
                autoComplete="off"
              />
              {fieldErrors.email && (
                <p className={errorClass}>{fieldErrors.email}</p>
              )}
            </div>

            <div>
              <label htmlFor="staff-name" className={labelClass}>
                Name
              </label>
              <input
                id="staff-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
                className={controlClass}
                placeholder="Front Desk Guard"
                autoComplete="off"
              />
              {fieldErrors.name && (
                <p className={errorClass}>{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="staff-role" className={labelClass}>
                Role
              </label>
              <select
                id="staff-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "ADMIN" | "GUARD")
                }
                className={controlClass}
              >
                <option value="GUARD">Guard — live list, check-out, history</option>
                <option value="ADMIN">Administrator — everything</option>
              </select>
            </div>

            <div>
              <label htmlFor="staff-password" className={labelClass}>
                Temporary password
              </label>
              <input
                id="staff-password"
                type="text"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearError("password");
                }}
                className={controlClass}
                placeholder={`At least ${minPasswordLength} characters`}
                autoComplete="off"
              />
              {fieldErrors.password && (
                <p className={errorClass}>{fieldErrors.password}</p>
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
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>

      {/* List ---------------------------------------------------------- */}
      <div className="space-y-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {staff.length} account{staff.length === 1 ? "" : "s"} · {adminCount}{" "}
          administrator{adminCount === 1 ? "" : "s"}
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Person
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Added
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {staff.map((member) => {
                  const isSelf = member.id === currentUserId;
                  const busy = pendingId === member.id;

                  return (
                    <tr key={member.id}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {member.name}
                          {isSelf && (
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              you
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {member.email}
                        </p>
                        {!member.canSignIn && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            No credential — this account cannot sign in.
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            member.role === "ADMIN"
                              ? "inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                              : "inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                          }
                        >
                          {member.role === "ADMIN" ? "Administrator" : "Guard"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatShortDate(member.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {confirmingId === member.id ? (
                            <>
                              <span className="self-center text-sm text-gray-500 dark:text-gray-400">
                                Remove {member.name}?
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void removeStaff(member.id)}
                                className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                              >
                                {busy ? "Removing…" : "Yes, remove"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmingId(null)}
                                className={neutralButtonClass}
                              >
                                Keep
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={busy || isSelf}
                                onClick={() => void changeRole(member)}
                                className={neutralButtonClass}
                                title={
                                  isSelf
                                    ? "Another administrator has to change your own role."
                                    : undefined
                                }
                              >
                                {member.role === "ADMIN"
                                  ? "Make guard"
                                  : "Make admin"}
                              </button>
                              <button
                                type="button"
                                disabled={busy || isSelf}
                                onClick={() => setConfirmingId(member.id)}
                                className={neutralButtonClass}
                                title={
                                  isSelf
                                    ? "You cannot remove the account you are signed in as."
                                    : undefined
                                }
                              >
                                Remove
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
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Removing an account deletes its logins and nothing else — no visit
          history refers to it. The last administrator cannot be removed or
          demoted.
        </p>
      </div>
    </div>
  );
}
