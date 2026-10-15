import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { databaseAdapter, databaseConfig } from "../src/lib/database-config";

const config = databaseConfig(process.env.DATABASE_URL);
console.log(`Audit cleanup target: database=${config.database} schema=${config.schema} host=${config.host}`);
const prisma = new PrismaClient({ adapter: databaseAdapter(process.env.DATABASE_URL) });
async function main() {
  let deleted = 0;
  let deactivated = 0;
  try {
    // Retain options used by any visitor or appointment, including historical visits.
    await prisma.$transaction(async (tx) => {
      const options = await tx.purposeOption.findMany({ where: { label: { startsWith: "[test]", mode: "insensitive" } }, include: { _count: { select: { visitors: true, appointments: true } } } });
      for (const option of options) {
        if (option._count.visitors || option._count.appointments) {
          await tx.purposeOption.update({ where: { id: option.id }, data: { isActive: false } });
          deactivated++;
        } else {
          await tx.purposeOption.delete({ where: { id: option.id } });
          deleted++;
        }
      }
    });
    console.log(`Removed ${deleted} unused [test] purposes; deactivated ${deactivated} referenced [test] purposes.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
