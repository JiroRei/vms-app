/**
 * The host directory — the people visitors come to see.
 *
 * `getHosts()` in `src/lib/visits.ts` stays where it is: it answers "who can a
 * visitor pick right now?" and is read by the kiosk on every check-in. This
 * module is the other half — managing the directory itself, which only the
 * dashboard does.
 *
 * Note what is missing: there is no delete. `Visitor.hostId` cascades, so
 * dropping a host row would take every visitor they ever received, and every
 * visit those visitors made, out of the history with it. Leaving is modelled as
 * `active: false`.
 */
import "server-only";

import { prisma } from "@/lib/prisma";

export type HostRecord = {
  id: string;
  name: string;
  department: string;
  active: boolean;
  /** How much history is attached, so the UI can say what deactivating keeps. */
  visitorCount: number;
  /** Unredeemed pre-registrations that would be left pointing at a closed door. */
  openAppointments: number;
};

export type HostInput = {
  name: string;
  department: string;
};

export type CreateHostResult = { status: "created"; host: HostRecord };

export type UpdateHostResult =
  | { status: "updated"; host: HostRecord }
  | { status: "not-found" };

/**
 * Every host, active first, with the weight of history behind each one.
 *
 * Inactive hosts are included: the history page filters by host, and a visit
 * from last year still belongs to whoever hosted it, whether or not they are
 * still taking visitors.
 */
export async function listHosts(): Promise<HostRecord[]> {
  const hosts = await prisma.host.findMany({
    orderBy: [{ active: "desc" }, { department: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          visitors: true,
          appointments: { where: { used: false } },
        },
      },
    },
  });

  return hosts.map((host) => ({
    id: host.id,
    name: host.name,
    department: host.department,
    active: host.active,
    visitorCount: host._count.visitors,
    openAppointments: host._count.appointments,
  }));
}

export async function createHost(input: HostInput): Promise<CreateHostResult> {
  const host = await prisma.host.create({
    data: { name: input.name, department: input.department },
  });

  return {
    status: "created",
    host: {
      id: host.id,
      name: host.name,
      department: host.department,
      active: host.active,
      visitorCount: 0,
      openAppointments: 0,
    },
  };
}

/**
 * Renames a host or moves them between departments, and switches them on or
 * off.
 *
 * Editing the name changes it everywhere the host appears, history included —
 * which is the point. A `Visit` records who was hosted, not what they were
 * called at the time, so a marriage or a department rename should not fork the
 * record into two people.
 */
export async function updateHost(
  id: string,
  input: Partial<HostInput> & { active?: boolean },
): Promise<UpdateHostResult> {
  const existing = await prisma.host.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    return { status: "not-found" };
  }

  await prisma.host.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.department !== undefined
        ? { department: input.department }
        : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });

  const host = await prisma.host.findUniqueOrThrow({
    where: { id },
    include: {
      _count: {
        select: {
          visitors: true,
          appointments: { where: { used: false } },
        },
      },
    },
  });

  return {
    status: "updated",
    host: {
      id: host.id,
      name: host.name,
      department: host.department,
      active: host.active,
      visitorCount: host._count.visitors,
      openAppointments: host._count.appointments,
    },
  };
}
