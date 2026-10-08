/**
 * Class names shared by the booking steps. Neutral greys for structure, the
 * `--accent` variable (see globals.css) for anything interactive or selected.
 * Inputs use a 16px font so iOS Safari doesn't zoom on focus.
 */

export const labelClass = "mb-1.5 block text-sm font-medium text-gray-800";

export function inputClass(invalid: boolean): string {
  return `block min-h-12 w-full rounded-lg border bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-2 focus:outline-offset-0 focus:outline-accent read-only:bg-gray-100 read-only:text-gray-700 ${
    invalid ? "border-red-500" : "border-gray-300"
  }`;
}

export const errorClass = "mt-1.5 text-sm text-red-700";

export const primaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-5 text-base font-medium text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const textButtonClass =
  "font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50";

/** The booking look, in the shape `NameFields` takes. */
export const nameFieldsClasses = {
  label: labelClass,
  input: inputClass,
  error: errorClass,
};
