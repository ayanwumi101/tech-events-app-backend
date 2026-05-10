import { FastifyInstance } from "fastify";

export const registerHealthRoutes = async (app: FastifyInstance) => {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "eventscout-backend",
      timestamp: new Date().toISOString(),
    };
  });
};
