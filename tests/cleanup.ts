import "./setup";
import { prisma } from "../src/lib/prisma";
import { resetDatabase } from "./helpers";
import { setTimeout } from "node:timers/promises";

async function main() {
  try {
    // Browser shutdown can briefly saturate Postgres; reset is idempotent.
    for (let attempt = 0; ; attempt++) {
      try { await resetDatabase(); break; }
      catch (error) {
        if (attempt === 2) throw error;
        await prisma.$disconnect();
        await setTimeout(500);
      }
    }
    console.log("Isolated test schema cleared.");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
