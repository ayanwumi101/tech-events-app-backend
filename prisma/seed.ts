import { prisma } from "../src/lib/prisma.js";
import { runIngestionScan } from "../src/services/ingestion/ingestion.service.js";

async function main() {
  await runIngestionScan();
  console.log("Seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
