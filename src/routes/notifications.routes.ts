import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthUser } from "../lib/auth-guard.js";
import { prisma } from "../lib/prisma.js";
import { parseOrReply } from "../lib/request-validation.js";
import { serializeNotification } from "../lib/serializers.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

export const registerNotificationRoutes = async (app: FastifyInstance) => {
  app.get("/notifications", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const query = parseOrReply(querySchema, request.query, reply);
    if (!query) {
      return;
    }

    const skip = (query.page - 1) * query.take;
    const [total, notifications] = await Promise.all([
      prisma.notification.count({
        where: { userId: user.id },
      }),
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.take,
      }),
    ]);

    const unreadCount = notifications.filter((item) => !item.readAt).length;

    return reply.send({
      ok: true,
      items: notifications.map(serializeNotification),
      unreadCount,
      pagination: {
        page: query.page,
        take: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    });
  });

  app.patch("/notifications/:id/read", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const { id } = request.params as { id: string };
    const updated = await prisma.notification.updateMany({
      where: {
        id,
        userId: user.id,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return reply.status(404).send({
        ok: false,
        message: "Notification not found.",
      });
    }

    return reply.send({
      ok: true,
      message: "Notification marked as read.",
    });
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return reply.send({
      ok: true,
      message: "All notifications marked as read.",
    });
  });
};
