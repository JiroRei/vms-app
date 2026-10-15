import { PrismaPg } from "@prisma/adapter-pg";

/** Shared by the app and scripts: pg does not interpret Prisma's ?schema=. */
export function databaseConfig(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_URL must be set.");
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") || "public";
  return { connectionString, schema, database: decodeURIComponent(url.pathname.slice(1)), host: url.host };
}

export function databaseAdapter(connectionString: string | undefined) {
  const config = databaseConfig(connectionString);
  return new PrismaPg({ connectionString: config.connectionString, connectionTimeoutMillis: 5000 }, { schema: config.schema });
}
