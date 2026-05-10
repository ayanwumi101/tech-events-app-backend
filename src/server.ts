import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";
import { runIngestionScan } from "./services/ingestion/ingestion.service.js";
import { startIngestionScheduler } from "./services/ingestion/scheduler.js";

const start = async () => {
  const app = createApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });

    app.log.info(`EventScout backend running on port ${env.PORT}`);

    startIngestionScheduler();

    runIngestionScan().catch((error) => {
      app.log.error({ error }, "Initial ingestion scan failed");
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
