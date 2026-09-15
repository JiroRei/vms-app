import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to Postgres through a driver adapter rather than a bundled
// query engine, so the connection string is handed to `pg` here.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Reuse one client across hot reloads in dev; Next.js re-evaluates modules on
// every change and a fresh client per reload exhausts the connection pool.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
