/** Compare actual targets, ignoring URL formatting, credentials and unrelated options. */
function target(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  const host = ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? "loopback" : hostname;
  return [host, url.port || "5432", decodeURIComponent(url.pathname), url.searchParams.get("schema") || "public"].join("|");
}
export function isolatedTestUrl(development: string | undefined, configured: string | undefined): string {
  if (!development) throw new Error("DATABASE_URL must be set for the isolation check.");
  const dev = new URL(development);
  const test = new URL(configured ?? development);
  if (!configured) test.searchParams.set("schema", "e2e");
  const schema = test.searchParams.get("schema");
  if (!schema || !/^[a-z][a-z0-9_]*$/.test(schema) || schema === "public") throw new Error("Tests require an explicit separate Postgres schema.");
  if (target(dev) === target(test)) throw new Error("Refusing tests: DATABASE_URL_TEST targets the development schema.");
  return test.toString();
}
export function assertTestDatabase(clientUrl = process.env.DATABASE_URL): void {
  isolatedTestUrl(process.env.VMS_DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
  if (!clientUrl || target(new URL(clientUrl)) !== target(new URL(process.env.DATABASE_URL!))) throw new Error("Refusing to clear data: Prisma client does not target the test schema.");
  const current = new URL(process.env.DATABASE_URL ?? "");
  if (!current.searchParams.get("schema") || current.searchParams.get("schema") === "public" || process.env.EMAIL_MODE !== "test") throw new Error("Refusing to clear data outside the isolated test schema.");
}
