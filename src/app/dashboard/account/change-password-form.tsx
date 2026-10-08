"use client";

import { useState } from "react";

const controlClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorClass = "mt-1 text-sm text-red-600 dark:text-red-400";

type FieldErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmPassword", string>
>;

export function ChangePasswordForm({
  minPasswordLength,
}: {
  minPasswordLength: number;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function clearError(field: keyof FieldErrors) {
    setFormError(null);
    setDone(false);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Checked here and not on the server: the server never sees this field.
    // Two boxes agreeing is a typo guard for the person typing, not a rule
    // about the password itself.
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: "These do not match." });
      document.getElementById("confirmPassword")?.focus();
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setDone(false);

    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          const serverErrors = data.fieldErrors as FieldErrors;
          setFieldErrors(serverErrors);
          const first = serverErrors.currentPassword
            ? "currentPassword"
            : "newPassword";
          document.getElementById(first)?.focus();
        } else {
          setFormError(data?.error ?? "Could not change your password.");
        }

        return;
      }

      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      noValidate
    >
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Change your password
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Everywhere else you are signed in will be signed out. This device
          stays signed in.
        </p>
      </div>

      {done && (
        <p
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200"
        >
          Password changed.
        </p>
      )}

      <div>
        <label htmlFor="currentPassword" className={labelClass}>
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
            clearError("currentPassword");
          }}
          className={controlClass}
          autoComplete="current-password"
        />
        {fieldErrors.currentPassword && (
          <p className={errorClass}>{fieldErrors.currentPassword}</p>
        )}
      </div>

      <div>
        <label htmlFor="newPassword" className={labelClass}>
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
            clearError("newPassword");
          }}
          className={controlClass}
          placeholder={`At least ${minPasswordLength} characters`}
          autoComplete="new-password"
        />
        {fieldErrors.newPassword && (
          <p className={errorClass}>{fieldErrors.newPassword}</p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className={labelClass}>
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            clearError("confirmPassword");
          }}
          className={controlClass}
          autoComplete="new-password"
        />
        {fieldErrors.confirmPassword && (
          <p className={errorClass}>{fieldErrors.confirmPassword}</p>
        )}
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
        {submitting ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
