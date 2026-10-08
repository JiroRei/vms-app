import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// TODO(multi-tenancy): every query in this file reads and writes the whole
// `purpose_option` table. Once organizations exist, each one needs an
// `organizationId` filter here — otherwise one client's admin editing this list
// silently rewrites every other client's dropdown. See MULTI_TENANCY_TODO.md.

/**
 * The label a delivery is recorded under.
 *
 * Deliveries collect no purpose from anyone — the guard's modal has no such
 * field and is not getting one — but the tables still have a Purpose column to
 * fill, and "Delivery" is what they showed before this became a lookup. Matched
 * by label rather than id because the row is created by the seed or the
 * backfill, neither of which can know an id in advance.
 */
export const DELIVERY_PURPOSE_LABEL = "Delivery";

/** What a dropdown needs. */
export type PurposeChoice = {
  id: string;
  label: string;
};

/** What the admin list needs. */
export type PurposeOptionRecord = PurposeChoice & {
  isActive: boolean;
  sortOrder: number;
};

/**
 * Display order for every list of options, admin and dropdown alike.
 *
 * `label` is the tie-break because `sortOrder` is not unique — a freshly created
 * option defaults to 0, and without a second key those would come back in
 * whatever order the database felt like, which reads as a list that reshuffles
 * itself.
 */
const DISPLAY_ORDER = [
  { sortOrder: "asc" },
  { label: "asc" },
] satisfies Prisma.PurposeOptionOrderByWithRelationInput[];

/**
 * The options a visitor may pick from. Retired ones are excluded here and only
 * here — historical records still point at them and must keep displaying.
 */
export async function getActivePurposeOptions(): Promise<PurposeChoice[]> {
  return prisma.purposeOption.findMany({
    where: { isActive: true },
    orderBy: DISPLAY_ORDER,
    select: { id: true, label: true },
  });
}

/** Everything, active or not, for the admin screen. */
export async function getPurposeOptions(): Promise<PurposeOptionRecord[]> {
  return prisma.purposeOption.findMany({
    orderBy: DISPLAY_ORDER,
    select: { id: true, label: true, isActive: true, sortOrder: true },
  });
}

/** `label` is unique, so a duplicate is a user error rather than a fault. */
export type PurposeWriteResult =
  | { ok: true; option: PurposeOptionRecord }
  | { ok: false; reason: "duplicate-label" | "not-found" };

function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  );
}

function isMissingRow(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2025"
  );
}

/**
 * Adds an option to the end of the list.
 *
 * The new `sortOrder` is one step past the current maximum rather than 0, so a
 * newly added option appears where the admin just added it — at the bottom —
 * instead of jumping to the top of a list whose other entries are numbered.
 */
export async function createPurposeOption(
  label: string,
): Promise<PurposeWriteResult> {
  try {
    const option = await prisma.$transaction(async (tx) => {
      const last = await tx.purposeOption.findFirst({
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });

      return tx.purposeOption.create({
        data: { label, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true, label: true, isActive: true, sortOrder: true },
      });
    });

    return { ok: true, option };
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return { ok: false, reason: "duplicate-label" };
    }

    throw cause;
  }
}

/**
 * Renames an option, retires it, or brings it back.
 *
 * Renaming is deliberately allowed to affect historical records: they reference
 * the row, so a typo fixed here is fixed everywhere it was ever shown, which is
 * the point of a lookup table. Retiring is the soft delete — there is no hard
 * delete, and the RESTRICT foreign key stops one being improvised.
 */
export async function updatePurposeOption(
  id: string,
  changes: { label?: string; isActive?: boolean },
): Promise<PurposeWriteResult> {
  try {
    const option = await prisma.purposeOption.update({
      where: { id },
      data: changes,
      select: { id: true, label: true, isActive: true, sortOrder: true },
    });

    return { ok: true, option };
  } catch (cause) {
    if (isUniqueViolation(cause)) return { ok: false, reason: "duplicate-label" };
    if (isMissingRow(cause)) return { ok: false, reason: "not-found" };

    throw cause;
  }
}

export type PurposeMoveResult = "moved" | "at-edge" | "not-found";

/**
 * Moves one option one place up or down.
 *
 * Renumbers the whole list from its new positions rather than swapping the two
 * `sortOrder` values. Swapping looks cheaper but breaks on a tie — every option
 * created before this screen existed defaults to 0, and swapping 0 with 0
 * silently does nothing. Renumbering also repairs those ties as a side effect.
 * The list is small enough that rewriting it is not worth optimising.
 */
export async function movePurposeOption(
  id: string,
  direction: "up" | "down",
): Promise<PurposeMoveResult> {
  return prisma.$transaction(async (tx) => {
    const options = await tx.purposeOption.findMany({
      orderBy: DISPLAY_ORDER,
      select: { id: true },
    });

    const index = options.findIndex((option) => option.id === id);

    if (index === -1) return "not-found";

    const target = direction === "up" ? index - 1 : index + 1;

    if (target < 0 || target >= options.length) return "at-edge";

    const reordered = [...options];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];

    for (const [position, option] of reordered.entries()) {
      await tx.purposeOption.update({
        where: { id: option.id },
        data: { sortOrder: (position + 1) * 10 },
      });
    }

    return "moved";
  });
}

/**
 * Checks a submitted option id is real and still offered.
 *
 * `isActive` is part of the test: a retired option must keep displaying on the
 * records that already reference it, but must not be accepted on a new one — and
 * a kiosk page rendered before the admin retired it would otherwise still post
 * it happily.
 */
export async function findSelectablePurpose(
  id: string,
): Promise<PurposeChoice | null> {
  return prisma.purposeOption.findFirst({
    where: { id, isActive: true },
    select: { id: true, label: true },
  });
}

/** The option deliveries are filed under, or null if nobody kept one. */
export async function findDeliveryPurposeId(): Promise<string | null> {
  const option = await prisma.purposeOption.findUnique({
    where: { label: DELIVERY_PURPOSE_LABEL },
    select: { id: true },
  });

  return option?.id ?? null;
}
