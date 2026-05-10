import cors from "@fastify/cors";
import Fastify from "fastify";

import { env } from "./config/env.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerEventRoutes } from "./routes/events.routes.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerIngestionRoutes } from "./routes/ingestion.routes.js";
import { registerNotificationRoutes } from "./routes/notifications.routes.js";
import { registerProfileRoutes } from "./routes/profile.routes.js";
import { registerPushRoutes } from "./routes/push.routes.js";

const resolveAllowedOrigins = () => {
  const raw = env.ALLOWED_ORIGINS.trim();
  if (raw === "*" || raw.length === 0) {
    return true;
  }
  const allowed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed;
};

export const createApp = () => {
  const app = Fastify({
    logger: env.NODE_ENV === "development",
  });

  app.register(cors, {
    origin: resolveAllowedOrigins(),
  });

  app.register(async (v1) => {
    await registerHealthRoutes(v1);
    await registerAuthRoutes(v1);
    await registerEventRoutes(v1);
    await registerNotificationRoutes(v1);
    await registerProfileRoutes(v1);
    await registerPushRoutes(v1);
    await registerIngestionRoutes(v1);
  }, { prefix: "/api/v1" });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(500).send({
      ok: false,
      message: "Unexpected server error.",
    });
  });

  return app;
};
