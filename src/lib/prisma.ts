import "server-only";

import { databaseAdapter } from "@/lib/database-config";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to Postgres through a driver adapter rather than a bundled
// query engine, so the connection string is handed to `pg` here.
export const prismaDatabaseUrl = process.env.DATABASE_URL;
const adapter = databaseAdapter(prismaDatabaseUrl);

// Reuse one client across hot reloads in dev; Next.js re-evaluates modules on
// every change and a fresh client per reload exhausts the connection pool.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
