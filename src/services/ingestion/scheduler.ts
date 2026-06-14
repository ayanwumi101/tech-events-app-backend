import cron from "node-cron";

import { env } from "../../config/env.js";
import { runIngestionScan } from "./ingestion.service.js";

export const startIngestionScheduler = () => {
  const expression = env.INGESTION_CRON_EXPRESSION;

  const task = cron.schedule(expression, async () => {
    try {
      await runIngestionScan();
    } catch {
      // Keep scheduler alive; failures are already tracked in ingestion runs.
    }
  });

  return task;
};
