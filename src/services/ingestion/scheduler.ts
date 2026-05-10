import cron from "node-cron";

import { env } from "../../config/env.js";
import { runIngestionScan } from "./ingestion.service.js";

export const startIngestionScheduler = () => {
  const interval = Math.max(1, env.INGESTION_INTERVAL_MINUTES);
  const expression = `*/${interval} * * * *`;

  const task = cron.schedule(expression, async () => {
    try {
      await runIngestionScan();
    } catch {
      // Keep scheduler alive; failures are already tracked in ingestion runs.
    }
  });

  return task;
};
