// Starts Next.js behind a plain Node HTTP server so the app can see each
// request's TCP connection address. Next.js route handlers have no access to
// the socket, and Next only fills X-Forwarded-For from it when the client did
// not send one, so without this a client could choose its own rate-limit key
// (KNOWN_ISSUES M-01). See src/lib/client-ip.ts for how the address is used.
//
//   node server.mjs               production (after `next build`), port $PORT or 3000
//   node server.mjs --dev         development with Turbopack
//   node server.mjs --port 3100   any mode, explicit port
//
// The nonce makes the header unforgeable: it is generated per process and
// only this file and the app (same process) know it.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const portIndex = args.indexOf("--port");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 3000);
const hostname = "localhost";

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port: ${portIndex >= 0 ? args[portIndex + 1] : process.env.PORT}`);
  process.exit(1);
}

process.env.NODE_ENV ??= dev ? "development" : "production";
const nonce = randomBytes(16).toString("hex");
process.env.VMS_CONNECTION_NONCE = nonce;

// Imported after NODE_ENV is set, as `next start` would have it.
const { default: next } = await import("next");

const server = createServer((req, res) => {
  // Always overwritten, so a client-supplied copy never survives.
  req.headers["x-vms-connection"] = `${nonce} ${req.socket.remoteAddress ?? ""}`;
  void handle(req, res);
});

const app = next({ dev, hostname, port, httpServer: server });
const handle = app.getRequestHandler();
await app.prepare();

server.listen(port, () => {
  console.log(`> Ready on http://${hostname}:${port} (${dev ? "development" : process.env.NODE_ENV})`);
});
