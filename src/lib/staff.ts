/**
 * Staff accounts — the people who sign in to the dashboard.
 *
 * Accounts are created here rather than through `auth.api.signUpEmail`, because
 * sign-up is switched off in `src/lib/auth.ts` and that check lives inside the
 * endpoint itself: calling it server-side is refused exactly as a request to
 * `/api/auth/sign-up/email` would be. So this writes the `user` row and its
 * credential `account` row directly, the same way `prisma/seed.ts` does, using
 * the same hasher Better Auth verifies against at sign-in.
 *
 * Deleting a staff account is safe in a way deleting a host is not: nothing in
 * the visit chain references `User`. Only `session` and `account` do, and both
 * cascade — an account's rows are its logins, not its history.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/** Matches Better Auth's own default, so both doors expect the same thing. */
export const MIN_PASSWORD_LENGTH = 8;

export type StaffMember = {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  /**
   * False for a `user` row with no credential `account` — a state the seed and
   * this module never produce, but which a hand-edited database can, and which
   * presents at the login form as a correct password being rejected.
   */
  canSignIn: boolean;
};

export type CreateStaffInput = {
  email: string;
  name: string;
  role: Role;
  password: string;
};

export type CreateStaffResult =
  | { status: "created"; staff: StaffMember }
  | { status: "email-taken" };

export type RoleChangeResult =
  | { status: "updated"; staff: StaffMember }
  | { status: "not-found" }
  | { status: "last-admin" };

export type DeleteStaffResult = "deleted" | "not-found" | "last-admin";

function toStaffMember(user: {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
  accounts: { id: string }[];
}): StaffMember {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    canSignIn: user.accounts.length > 0,
  };
}

const CREDENTIAL_ACCOUNT = { where: { providerId: "credential" }, select: { id: true } };

export async function listStaff(): Promise<StaffMember[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { accounts: CREDENTIAL_ACCOUNT },
  });

  return users.map(toStaffMember);
}

/** How many administrators exist. The guard against locking everyone out. */
export async function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: Role.ADMIN } });
}

export async function createStaff(
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    return { status: "email-taken" };
  }

  const hashed = await hashPassword(input.password);

  // One transaction: a `user` with no credential `account` cannot sign in, and
  // would present as a correct password being rejected with no way to tell why.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, name: input.name, role: input.role, emailVerified: true },
    });

    await tx.account.create({
      data: {
        id: randomUUID(),
        // Sign-in matches on both of these, so both have to be right.
        accountId: created.id,
        providerId: "credential",
        userId: created.id,
        password: hashed,
      },
    });

    return created;
  });

  return {
    status: "created",
    staff: toStaffMember({ ...user, accounts: [{ id: "" }] }),
  };
}

/**
 * Promotes or demotes someone.
 *
 * Refuses to demote the last administrator: there would then be nobody who
 * could promote anyone, and the only way back in would be re-running the seed.
 */
export async function setStaffRole(
  id: string,
  role: Role,
): Promise<RoleChangeResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });

  if (!user) {
    return { status: "not-found" };
  }

  if (user.role === Role.ADMIN && role !== Role.ADMIN) {
    if ((await countAdmins()) <= 1) {
      return { status: "last-admin" };
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role },
    include: { accounts: CREDENTIAL_ACCOUNT },
  });

  return { status: "updated", staff: toStaffMember(updated) };
}

/**
 * Removes a staff account and, by cascade, its sessions and credential.
 *
 * Same last-administrator guard as the demotion above, for the same reason.
 * Whether someone may delete *themselves* is the caller's question, not this
 * one's — the route has the session and answers it there.
 */
export async function deleteStaff(id: string): Promise<DeleteStaffResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });

  if (!user) {
    return "not-found";
  }

  if (user.role === Role.ADMIN && (await countAdmins()) <= 1) {
    return "last-admin";
  }

  await prisma.user.delete({ where: { id } });

  return "deleted";
}
