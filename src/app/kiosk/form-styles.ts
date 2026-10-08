/**
 * Shared control styling for the three kiosk forms.
 *
 * Sized for a finger on a wall-mounted tablet rather than a mouse: every
 * control clears the ~44px minimum touch target, and the 16px text is
 * deliberate — iOS Safari zooms the whole page in when a focused input's text
 * is smaller than that, which on a kiosk leaves the form half off-screen.
 *
 * Font size lives in the variants rather than the base, so composing one of
 * these with a size utility at the call site can never produce two competing
 * `text-*` classes.
 */

const inputBase =
  "block w-full rounded-lg border px-4 py-3 shadow-sm transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-1";

/** The error state only recolors: the box must not resize as it goes invalid. */
function inputTone(hasError: boolean): string {
  return hasError
    ? "border-red-400 focus:border-red-500 focus:ring-red-500"
    : "border-gray-300 focus:border-blue-500 focus:ring-blue-500";
}

/** The standard text input / select. */
export function inputClass(hasError: boolean): string {
  return `${inputBase} text-base ${inputTone(hasError)}`;
}

/** Larger, centered, letter-spaced — for typing a reference number. */
export function codeInputClass(hasError: boolean): string {
  return `${inputBase} text-center text-lg font-semibold uppercase tracking-widest ${inputTone(hasError)}`;
}

export const labelClass = "mb-1.5 block text-sm font-medium text-gray-700";

export const primaryButtonClass =
  "w-full rounded-lg bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300";

export const secondaryButtonClass =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-3.5 text-base font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Sits under the field it belongs to, referenced by the input's `aria-describedby`. */
export const fieldErrorClass = "mt-1.5 text-sm font-medium text-red-600";

/** Whole-form failures — a rejected submit, a dead network. */
export const formErrorClass =
  "rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700";
