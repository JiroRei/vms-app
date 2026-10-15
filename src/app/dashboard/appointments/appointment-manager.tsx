"use client";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BOOKING_TIMEZONE_LABEL } from "@/lib/booking-config";
import { NameFields } from "@/components/name-fields";
import { formatFullName, validateNameParts } from "@/lib/names";
import type { PurposeChoice } from "@/lib/purposes";
import type { HostOption } from "@/lib/visits";

const controlClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";
const errorClass = "mt-1 text-sm text-red-600 dark:text-red-400";

type FieldName =
  | "firstName"
  | "lastName"
  | "visitorEmail"
  | "purposeId"
  | "hostId"
  | "scheduledFor";
type FieldErrors = Partial<Record<FieldName, string>>;

/** The order fields appear in, so a failed submit focuses the topmost one. */
const FIELD_ORDER: FieldName[] = [
  "firstName",
  "lastName",
  "visitorEmail",
  "purposeId",
  "hostId",
  "scheduledFor",
];

/** `NameFields` in the dashboard's look. */
const nameFieldsClasses = {
  label: "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300",
  input: (invalid: boolean) =>
    `w-full rounded-lg border px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 dark:bg-gray-800 dark:text-white ${
      invalid
        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600"
    }`,
  error: "mt-1 text-sm text-red-600 dark:text-red-400",
};

type Created = {
  referenceNumber: string;
  firstName: string;
  lastName: string;
  visitorEmail: string;
  emailSent: boolean;
  emailQueued?: boolean;
};

function focusFirstError(errors: FieldErrors) {
  const first = FIELD_ORDER.find((field) => errors[field]);
  if (first) document.getElementById(first)?.focus();
}

/** The pre-registration form. The list lives in `AppointmentBoard`. */
export function AppointmentManager({
  hosts,
  purposes,
}: {
  hosts: HostOption[];
  /** Active options only. */
  purposes: PurposeChoice[];
}) {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [hostId, setHostId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * The reference the last submit produced. This is the whole point of the
   * form — the visitor cannot check in without it — so it stays on screen
   * until the receptionist starts another one, rather than flashing past as a
   * toast.
   */
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  /** Drops a field's complaint as soon as it is being corrected. */
  function clearError(field: FieldName) {
    setFormError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = validateNameParts(firstName, lastName);

    if (!visitorEmail.trim()) {
      errors.visitorEmail = "Please enter the visitor's email address.";
    }
    if (!purposeId) {
      errors.purposeId = "Please choose the purpose of the visit.";
    }
    if (!hostId) {
      errors.hostId = "Please choose who they are here to see.";
    }
    if (!scheduledFor) {
      errors.scheduledFor = "Please choose when they are expected.";
    }

    return errors;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Guards a double-submit landing before React re-renders the disabled
    // button — the same pattern the kiosk forms use.
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/appointments/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          visitorEmail: visitorEmail.trim(),
          purposeId,
          hostId,
          // The server converts this wall-clock value in the site zone.
          scheduledFor,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          const serverErrors = data.fieldErrors as FieldErrors;
          setFieldErrors(serverErrors);
          focusFirstError(serverErrors);
        } else if (response.status === 401) {
          setFormError("Your session has ended. Please sign in again.");
          router.refresh();
        } else {
          setFormError(apiErrorMessage(data?.error) ?? "Could not create this appointment.");
        }

        return;
      }

      const data = (await response.json()) as {
        appointment: Omit<Created, "emailSent">;
        emailSent: boolean;
        emailQueued?: boolean;
      };

      setCreated({ ...data.appointment, emailSent: data.emailSent, emailQueued: data.emailQueued });
      setCopied(false);
      setFirstName("");
      setLastName("");
      setVisitorEmail("");
      setPurposeId("");
      setHostId("");
      setScheduledFor("");
      // The list is server-rendered, so ask the server for it again rather
      // than splicing a row in and hoping the two agree.
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The reference is on screen
      // and selectable, so this is a convenience failing, not the task.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Create                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Pre-register a visitor
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Creates a QR code and reference number for the kiosk, and emails them
          to the visitor. It works once.
        </p>

        {created && (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-500/40 dark:bg-green-500/10">
            <p className="text-sm font-medium text-green-900 dark:text-green-200">
              {formatFullName(created.firstName, created.lastName)} is
              pre-registered.{" "}
              {created.emailSent
                ? `Their QR code was emailed to ${created.visitorEmail}. The reference also works:`
                : created.emailQueued ? "Their email is queued for delivery. Give them this reference while they wait:" : "The email could not be sent, so give them this reference:"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="rounded-md bg-white px-3 py-2 font-mono text-xl font-bold tracking-wider text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white">
                {created.referenceNumber}
              </code>
              <button
                type="button"
                onClick={() => void copyReference(created.referenceNumber)}
                className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-800 shadow-sm transition-colors hover:bg-green-100 dark:border-green-500/40 dark:bg-gray-800 dark:text-green-300 dark:hover:bg-green-500/20"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <NameFields
                firstName={firstName}
                lastName={lastName}
                onChange={(field, value) => {
                  if (field === "firstName") setFirstName(value);
                  else setLastName(value);
                  clearError(field);
                }}
                errors={fieldErrors}
                classes={nameFieldsClasses}
              />
            </div>

            <div>
              <label htmlFor="visitorEmail" className={labelClass}>
                Email
              </label>
              <input
                id="visitorEmail"
                type="email"
                value={visitorEmail}
                onChange={(event) => {
                  setVisitorEmail(event.target.value);
                  clearError("visitorEmail");
                }}
                className={controlClass}
                placeholder="visitor@example.com"
                autoComplete="off"
                aria-describedby={
                  fieldErrors.visitorEmail ? "visitorEmail-error" : undefined
                }
              />
              {fieldErrors.visitorEmail && (
                <p id="visitorEmail-error" className={errorClass}>
                  {fieldErrors.visitorEmail}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="purposeId" className={labelClass}>
                Purpose
              </label>
              <select
                autoComplete="off"
                id="purposeId"
                value={purposeId}
                onChange={(event) => {
                  setPurposeId(event.target.value);
                  clearError("purposeId");
                }}
                className={controlClass}
                aria-describedby={
                  fieldErrors.purposeId ? "purposeId-error" : undefined
                }
              >
                <option value="">Select a purpose…</option>
                {purposes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.purposeId && (
                <p id="purposeId-error" className={errorClass}>
                  {fieldErrors.purposeId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="hostId" className={labelClass}>
                Host
              </label>
              <select
                autoComplete="off"
                id="hostId"
                value={hostId}
                onChange={(event) => {
                  setHostId(event.target.value);
                  clearError("hostId");
                }}
                className={controlClass}
                aria-describedby={
                  fieldErrors.hostId ? "hostId-error" : undefined
                }
              >
                <option value="">Select a host…</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name} — {host.department}
                  </option>
                ))}
              </select>
              {fieldErrors.hostId && (
                <p id="hostId-error" className={errorClass}>
                  {fieldErrors.hostId}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="scheduledFor" className={labelClass}>
                Expected ({BOOKING_TIMEZONE_LABEL})
              </label>
              <input
                autoComplete="off"
                id="scheduledFor"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => {
                  setScheduledFor(event.target.value);
                  clearError("scheduledFor");
                }}
                className={controlClass}
                aria-describedby={
                  fieldErrors.scheduledFor ? "scheduledFor-error" : undefined
                }
              />
              {fieldErrors.scheduledFor && (
                <p id="scheduledFor-error" className={errorClass}>
                  {fieldErrors.scheduledFor}
                </p>
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
            {submitting ? "Creating…" : "Create appointment"}
          </button>
        </form>
      </div>

    </div>
  );
}
