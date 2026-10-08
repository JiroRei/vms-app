"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import type { HostOption } from "@/lib/visits";

/** Select value standing for "not one of the hosts — type it instead". */
const OTHER = "__other__";

type FieldErrors = Partial<
  Record<"name" | "hostId" | "recipientDepartment" | "note", string>
>;

const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-200";
const controlClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500";
const errorControlClass = controlClass.replace(
  "border-gray-300",
  "border-red-400",
);

/**
 * The dashboard's delivery quick action: one button, one modal, no navigation.
 *
 * Deliveries used to be a kiosk flow, which meant handing the visitor terminal
 * to a courier who only wanted to drop a parcel and leave. It is a guard action
 * now, and the modal is the point — the live list stays on screen underneath,
 * so whatever the guard was doing with a visitor is still there afterwards.
 */
export function LogDelivery({ hosts }: { hosts: HostOption[] }) {
  const showToast = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [otherDepartment, setOtherDepartment] = useState("");
  const [note, setNote] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  // Focus goes back where it came from on close, so a keyboard user is not
  // dropped at the top of the page.
  const triggerRef = useRef<HTMLButtonElement>(null);

  function openModal() {
    setName("");
    setRecipient("");
    setOtherDepartment("");
    setNote("");
    setFieldErrors({});
    setFormError(null);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    nameRef.current?.focus();

    // A guard logging a delivery between two visitors wants out of this fast.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    if (!name.trim()) {
      setFieldErrors({ name: "Please enter the courier or company name." });
      setFormError(null);
      nameRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          // A picked host and a typed department are one field to the guard, so
          // only ever one of them is sent.
          hostId: recipient && recipient !== OTHER ? recipient : null,
          recipientDepartment:
            recipient === OTHER ? otherDepartment.trim() || null : null,
          note: note.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
        } else {
          setFormError(
            data?.error ?? "Could not log this delivery. Please try again.",
          );
        }

        return;
      }

      // Nothing to refresh: the record is complete on arrival, so it never
      // joins the live list. The toast is the whole confirmation.
      closeModal();
      showToast("Delivery logged");
    } catch {
      setFormError("Network problem — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openModal}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
      >
        <span aria-hidden className="text-base">
          📦
        </span>
        Log delivery
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-delivery-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h2
                id="log-delivery-title"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                Log a delivery
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Recorded as a completed drop-off — nothing to check out later.
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
              <div>
                <label htmlFor="courier-name" className={labelClass}>
                  Courier / company name
                </label>
                <input
                  ref={nameRef}
                  id="courier-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. LBC Express"
                  aria-invalid={Boolean(fieldErrors.name)}
                  className={fieldErrors.name ? errorControlClass : controlClass}
                />
                {fieldErrors.name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {fieldErrors.name}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="recipient" className={labelClass}>
                  Recipient department{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <select
                  id="recipient"
                  name="recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.hostId)}
                  className={
                    fieldErrors.hostId ? errorControlClass : controlClass
                  }
                >
                  <option value="">Leave at reception</option>
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name} — {host.department}
                    </option>
                  ))}
                  <option value={OTHER}>Other — type it in</option>
                </select>
                {fieldErrors.hostId && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {fieldErrors.hostId}
                  </p>
                )}

                {recipient === OTHER && (
                  <>
                    <input
                      id="other-department"
                      name="recipientDepartment"
                      type="text"
                      value={otherDepartment}
                      onChange={(event) =>
                        setOtherDepartment(event.target.value)
                      }
                      placeholder="Department or person"
                      aria-label="Recipient department"
                      autoFocus
                      aria-invalid={Boolean(fieldErrors.recipientDepartment)}
                      className={
                        fieldErrors.recipientDepartment
                          ? errorControlClass
                          : controlClass
                      }
                    />
                    {fieldErrors.recipientDepartment && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {fieldErrors.recipientDepartment}
                      </p>
                    )}
                  </>
                )}
              </div>

              <div>
                <label htmlFor="delivery-note" className={labelClass}>
                  Note{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  id="delivery-note"
                  name="note"
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Left at the front desk"
                  aria-invalid={Boolean(fieldErrors.note)}
                  className={fieldErrors.note ? errorControlClass : controlClass}
                />
                {fieldErrors.note && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {fieldErrors.note}
                  </p>
                )}
              </div>

              {formError && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-11 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300 dark:disabled:bg-violet-900"
                >
                  {submitting ? "Logging…" : "Log delivery"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
