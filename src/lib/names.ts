/**
 * Visitor names: one set of rules for capturing, storing, matching and showing
 * them. Pure, so the forms validate exactly as the API routes do.
 *
 * A name is stored as two parts, `firstName` and `lastName`, with the casing
 * the visitor typed (only whitespace is tidied). `lastName` can be empty on
 * older records — single-word names were backfilled that way — but every form
 * requires both.
 */

/** Longest a single name part may be. */
export const MAX_NAME_PART = 80;

export type NameField = "firstName" | "lastName";
export type NameErrors = Partial<Record<NameField, string>>;

/** Trim and collapse runs of whitespace; casing is kept as typed. */
export function cleanNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** "First Last", or just "First" when the last name is empty. */
export function formatFullName(firstName: string, lastName: string): string {
  return [cleanNamePart(firstName), cleanNamePart(lastName)]
    .filter(Boolean)
    .join(" ");
}

function keyPart(value: string): string {
  return cleanNamePart(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * The matching form of a name: lower-cased, accent-stripped, whitespace
 * collapsed, parts joined with "|" — so "José  García" and "jose garcia" are
 * the same person, while the "|" keeps "Ann Marie|Smith" apart from
 * "Ann|Marie Smith".
 */
export function makeNameKey(firstName: string, lastName: string): string {
  return `${keyPart(firstName)}|${keyPart(lastName)}`;
}

/** The checks every name form applies, with identical wording everywhere. */
export function validateNameParts(
  firstName: string,
  lastName: string,
): NameErrors {
  const errors: NameErrors = {};
  const first = cleanNamePart(firstName);
  const last = cleanNamePart(lastName);

  if (!first) errors.firstName = "Please enter your first name.";
  else if (first.length > MAX_NAME_PART)
    errors.firstName = `Please keep this under ${MAX_NAME_PART} characters.`;

  if (!last) errors.lastName = "Please enter your last name.";
  else if (last.length > MAX_NAME_PART)
    errors.lastName = `Please keep this under ${MAX_NAME_PART} characters.`;

  return errors;
}

/**
 * Reads and validates `firstName`/`lastName` from an untrusted request body,
 * for the API routes.
 */
export function parseNameParts(body: Record<string, unknown>):
  | { ok: true; firstName: string; lastName: string }
  | { ok: false; errors: NameErrors } {
  const firstName =
    typeof body.firstName === "string" ? cleanNamePart(body.firstName) : "";
  const lastName =
    typeof body.lastName === "string" ? cleanNamePart(body.lastName) : "";
  const errors = validateNameParts(firstName, lastName);

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, firstName, lastName };
}
