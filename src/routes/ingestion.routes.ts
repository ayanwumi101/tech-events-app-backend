import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthUser } from "../lib/auth-guard.js";
import { parseSourceType } from "../lib/mappers.js";
import { prisma } from "../lib/prisma.js";
import { parseOrReply } from "../lib/request-validation.js";
import { runIngestionScan } from "../services/ingestion/ingestion.service.js";

const sourceSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["social-media", "website", "newsletter", "community"]),
  url: z.string().url(),
});

export const registerIngestionRoutes = async (app: FastifyInstance) => {
  app.post("/ingestion/run", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    try {
      const result = await runIngestionScan();
      return reply.send({
        ok: true,
        message: "AI ingestion completed.",
        run: result,
      });
    } catch {
      return reply.status(500).send({
        ok: false,
        message: "AI ingestion failed. Check logs and provider configuration.",
      });
    }
  });

  app.get("/ingestion/runs", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const runs = await prisma.ingestionRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    return reply.send({
      ok: true,
      items: runs.map((run) => ({
        id: run.id,
        status: run.status.toLowerCase(),
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        discovered: run.discovered,
        updated: run.updated,
        provider: run.provider,
        sourceCount: run.sourceCount,
        message: run.message,
      })),
    });
  });

  app.get("/ingestion/sources", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const sources = await prisma.aiSource.findMany({
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      ok: true,
      items: sources.map((source) => ({
        id: source.id,
        name: source.name,
        type:
          source.type === "SOCIAL_MEDIA"
            ? "social-media"
            : source.type.toLowerCase(),
        url: source.url,
        isActive: source.isActive,
        lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post("/ingestion/sources", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(sourceSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const type = parseSourceType(payload.type);
    if (!type) {
      return reply.status(400).send({
        ok: false,
        message: "Unsupported source type.",
      });
    }

    const created = await prisma.aiSource.create({
      data: {
        name: payload.name.trim(),
        type,
        url: payload.url.trim(),
      },
    });

    return reply.send({
      ok: true,
      message: "AI source added.",
      item: {
        id: created.id,
        name: created.name,
      },
    });
  });

  app.patch("/ingestion/sources/:id/toggle", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const { id } = request.params as { id: string };
    const source = await prisma.aiSource.findUnique({
      where: { id },
    });

    if (!source) {
      return reply.status(404).send({
        ok: false,
        message: "Source not found.",
      });
    }

    const updated = await prisma.aiSource.update({
      where: { id },
      data: {
        isActive: !source.isActive,
      },
    });

    return reply.send({
      ok: true,
      message: updated.isActive ? "Source enabled." : "Source disabled.",
      item: {
        id: updated.id,
        isActive: updated.isActive,
      },
    });
  });
};
