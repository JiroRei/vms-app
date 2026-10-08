"use client";

import type { NameErrors, NameField } from "@/lib/names";
import { MAX_NAME_PART } from "@/lib/names";

/**
 * The "First name" / "Last name" pair used by every form that captures a
 * visitor's name. Labels, autocomplete tokens and error wiring live here so
 * they cannot drift between forms; validation is `validateNameParts()` in
 * `src/lib/names.ts`, which the API routes run too.
 *
 * Only the look is per-form (the kiosk and the booking page are styled
 * differently), passed in through `classes`.
 */
export type NameFieldsClasses = {
  label: string;
  input: (invalid: boolean) => string;
  error: string;
};

const DEFAULT_CLASSES: NameFieldsClasses = {
  label: "mb-1 block text-sm font-medium text-gray-700",
  input: (invalid) =>
    `block w-full rounded-lg border px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 read-only:bg-gray-100 ${
      invalid
        ? "border-red-400 focus:border-red-500 focus:ring-red-500"
        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
    }`,
  error: "mt-1 text-sm text-red-600",
};

const FIELDS: { field: NameField; label: string; autoComplete: string }[] = [
  { field: "firstName", label: "First name", autoComplete: "given-name" },
  { field: "lastName", label: "Last name", autoComplete: "family-name" },
];

export function NameFields({
  idPrefix = "",
  firstName,
  lastName,
  onChange,
  errors = {},
  readOnly = false,
  classes = DEFAULT_CLASSES,
}: {
  /** Prefix for the input ids, when one page shows two name pairs. */
  idPrefix?: string;
  firstName: string;
  lastName: string;
  onChange: (field: NameField, value: string) => void;
  errors?: NameErrors;
  readOnly?: boolean;
  classes?: NameFieldsClasses;
}) {
  const values = { firstName, lastName };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(({ field, label, autoComplete }) => {
        const id = `${idPrefix}${field}`;
        const error = errors[field];

        return (
          <div key={field}>
            <label htmlFor={id} className={classes.label}>
              {label}
            </label>
            <input
              id={id}
              name={field}
              type="text"
              autoComplete={autoComplete}
              autoCapitalize="words"
              required
              maxLength={MAX_NAME_PART}
              readOnly={readOnly}
              value={values[field]}
              onChange={(event) => onChange(field, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}Error` : undefined}
              className={classes.input(Boolean(error))}
            />
            {error && (
              <p id={`${id}Error`} className={classes.error}>
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
