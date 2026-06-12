import { AttendanceStatus, EventStatus } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import { getOptionalAuthUser, requireAuthUser } from "../lib/auth-guard.js";
import { parseAttendanceStatus, parseEventCategory } from "../lib/mappers.js";
import { prisma } from "../lib/prisma.js";
import { parseOrReply } from "../lib/request-validation.js";
import { serializeAttendanceStatus, serializeEvent } from "../lib/serializers.js";
import { createNotificationForUser } from "../services/notification.service.js";

const listQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(["upcoming", "ongoing", "expired", "cancelled"]).optional(),
  city: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
  page: z.coerce.number().int().min(1).default(1),
});

const favoriteSchema = z.object({
  isFavorite: z.boolean(),
});

const attendanceSchema = z.object({
  status: z.enum(["going", "not-going"]),
});

const feedbackSchema = z.object({
  title: z.string().min(2).max(120),
  rating: z.number().min(1).max(5),
  message: z.string().min(10).max(2000),
  images: z.array(z.string().url()).max(5).default([]),
});

export const registerEventRoutes = async (app: FastifyInstance) => {
  app.get("/events", async (request, reply) => {
    const query = parseOrReply(listQuerySchema, request.query, reply);
    if (!query) {
      return;
    }

    const authUser = await getOptionalAuthUser(request);
    const skip = (query.page - 1) * query.take;
    const category = query.category ? parseEventCategory(query.category) : null;

    const statusFilter: EventStatus | null = query.status
      ? (query.status.toUpperCase() as EventStatus)
      : null;

    const where = {
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                summary: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                sourceName: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
      ...(category ? { category } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query.city
        ? {
            city: {
              contains: query.city.trim(),
              mode: "insensitive" as const,
            },
          }
        : {}),
    };

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: [{ ingestedAt: "desc" }, { startDate: "asc" }],
        take: query.take,
        skip,
      }),
    ]);

    let favoriteSet = new Set<string>();
    let attendanceMap = new Map<string, AttendanceStatus>();

    if (authUser) {
      const [favorites, attendance] = await Promise.all([
        prisma.favorite.findMany({
          where: {
            userId: authUser.id,
            eventId: {
              in: events.map((event) => event.id),
            },
          },
          select: { eventId: true },
        }),
        prisma.attendance.findMany({
          where: {
            userId: authUser.id,
            eventId: {
              in: events.map((event) => event.id),
            },
          },
          select: {
            eventId: true,
            status: true,
          },
        }),
      ]);

      favoriteSet = new Set(favorites.map((item) => item.eventId));
      attendanceMap = new Map(attendance.map((item) => [item.eventId, item.status]));
    }

    return reply.send({
      ok: true,
      items: events.map((event) =>
        serializeEvent(event, {
          isFavorite: favoriteSet.has(event.id),
          attendance: attendanceMap.has(event.id)
            ? ({
                status: attendanceMap.get(event.id)!,
              } as { status: AttendanceStatus })
            : null,
        }),
      ),
      pagination: {
        page: query.page,
        take: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    });
  });

  app.get("/events/favorites", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      include: {
        event: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const eventIds = favorites.map((item) => item.eventId);
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        userId: user.id,
        eventId: {
          in: eventIds,
        },
      },
      select: {
        eventId: true,
        status: true,
      },
    });

    const attendanceMap = new Map(
      attendanceRecords.map((item) => [item.eventId, item.status]),
    );

    return reply.send({
      ok: true,
      items: favorites.map((favorite) =>
        serializeEvent(favorite.event, {
          isFavorite: true,
          attendance: attendanceMap.has(favorite.eventId)
            ? ({
                status: attendanceMap.get(favorite.eventId)!,
              } as { status: AttendanceStatus })
            : null,
        }),
      ),
    });
  });

  app.get("/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = await getOptionalAuthUser(request);

    const event = await prisma.event.findUnique({
      where: { id },
    });
    if (!event) {
      return reply.status(404).send({
        ok: false,
        message: "Event not found.",
      });
    }

    let isFavorite = false;
    let attendance: { status: AttendanceStatus } | null = null;

    if (authUser) {
      const [favorite, attendanceRecord] = await Promise.all([
        prisma.favorite.findUnique({
          where: {
            userId_eventId: {
              userId: authUser.id,
              eventId: id,
            },
          },
        }),
        prisma.attendance.findUnique({
          where: {
            userId_eventId: {
              userId: authUser.id,
              eventId: id,
            },
          },
          select: { status: true },
        }),
      ]);

      isFavorite = Boolean(favorite);
      attendance = attendanceRecord ? { status: attendanceRecord.status } : null;
    }

    return reply.send({
      ok: true,
      item: serializeEvent(event, {
        isFavorite,
        attendance,
      }),
    });
  });

  app.post("/events/:id/favorite", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(favoriteSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const { id: eventId } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      return reply.status(404).send({
        ok: false,
        message: "Event not found.",
      });
    }

    if (payload.isFavorite) {
      await prisma.favorite.upsert({
        where: {
          userId_eventId: {
            userId: user.id,
            eventId,
          },
        },
        create: {
          userId: user.id,
          eventId,
        },
        update: {},
      });
    } else {
      await prisma.favorite.deleteMany({
        where: {
          userId: user.id,
          eventId,
        },
      });
    }

    return reply.send({
      ok: true,
      message: payload.isFavorite
        ? "Event added to favourites."
        : "Event removed from favourites.",
    });
  });

  app.patch("/events/:id/attendance", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(attendanceSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const { id: eventId } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      return reply.status(404).send({
        ok: false,
        message: "Event not found.",
      });
    }

    const status = parseAttendanceStatus(payload.status);
    if (!status) {
      return reply.status(400).send({
        ok: false,
        message: "Unsupported attendance status.",
      });
    }

    await prisma.attendance.upsert({
      where: {
        userId_eventId: {
          userId: user.id,
          eventId,
        },
      },
      create: {
        userId: user.id,
        eventId,
        status,
      },
      update: {
        status,
        decidedAt: new Date(),
      },
    });

    const attendanceMessage =
      status === "GOING"
        ? `You are attending ${event.title}.`
        : `You marked ${event.title} as not attending.`;

    await createNotificationForUser({
      userId: user.id,
      eventId,
      title: "Attendance updated",
      message: attendanceMessage,
      push: {
        deepLink: `eventscout://event/${eventId}`,
      },
    });

    return reply.send({
      ok: true,
      message: "Attendance status updated.",
      status: serializeAttendanceStatus(status),
    });
  });

  app.get("/events/history", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const records = await prisma.attendance.findMany({
      where: { userId: user.id },
      include: { event: true },
      orderBy: { decidedAt: "desc" },
    });

    return reply.send({
      ok: true,
      items: records.map((record) => ({
        eventId: record.eventId,
        status: serializeAttendanceStatus(record.status),
        decidedAt: record.decidedAt.toISOString(),
        event: serializeEvent(record.event),
      })),
    });
  });

  app.post("/events/:id/feedback", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(feedbackSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const { id: eventId } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true },
    });

    if (!event) {
      return reply.status(404).send({
        ok: false,
        message: "Event not found.",
      });
    }

    await prisma.feedback.create({
      data: {
        userId: user.id,
        eventId,
        title: payload.title.trim(),
        rating: payload.rating,
        message: payload.message.trim(),
        images: payload.images,
      },
    });

    await createNotificationForUser({
      userId: user.id,
      eventId,
      title: "Feedback saved",
      message: `Your feedback for ${event.title} was submitted.`,
      push: {
        deepLink: `eventscout://event/${eventId}`,
      },
    });

    return reply.send({
      ok: true,
      message: "Feedback submitted successfully.",
    });
  });

  app.get("/events/:id/deep-link", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!event) {
      return reply.status(404).send({
        ok: false,
        message: "Event not found.",
      });
    }

    const appScheme = env.CLIENT_DEEP_LINK_SCHEME.endsWith("://")
      ? env.CLIENT_DEEP_LINK_SCHEME
      : `${env.CLIENT_DEEP_LINK_SCHEME.replace(/\/+$/, "")}://`;
    const webBase = env.WEB_DEEP_LINK_BASE.replace(/\/+$/, "");

    return reply.send({
      ok: true,
      appLink: `${appScheme}event/${event.id}`,
      webLink: `${webBase}/event/${event.id}`,
    });
  });
};
