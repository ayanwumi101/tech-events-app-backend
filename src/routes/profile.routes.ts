import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthUser } from "../lib/auth-guard.js";
import { parseThemeMode } from "../lib/mappers.js";
import { prisma } from "../lib/prisma.js";
import { parseOrReply } from "../lib/request-validation.js";
import { serializeUser } from "../lib/serializers.js";

const updateProfileSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  country: z.string().min(2),
  role: z.string().min(2),
  themeMode: z.enum(["light", "dark"]).optional(),
});

export const registerProfileRoutes = async (app: FastifyInstance) => {
  app.get("/profile", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const [favoriteCount, attendanceCount, unreadNotificationCount] =
      await Promise.all([
        prisma.favorite.count({
          where: { userId: user.id },
        }),
        prisma.attendance.count({
          where: { userId: user.id },
        }),
        prisma.notification.count({
          where: {
            userId: user.id,
            readAt: null,
          },
        }),
      ]);

    return reply.send({
      ok: true,
      user: serializeUser(user),
      stats: {
        favoriteCount,
        attendanceCount,
        unreadNotificationCount,
      },
    });
  });

  app.patch("/profile", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(updateProfileSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const nextEmail = payload.email.toLowerCase().trim();

    if (nextEmail !== user.email) {
      const emailOwner = await prisma.user.findUnique({
        where: { email: nextEmail },
        select: { id: true },
      });
      if (emailOwner && emailOwner.id !== user.id) {
        return reply.status(409).send({
          ok: false,
          message: "This email is already used by another account.",
        });
      }
    }

    const nextTheme = payload.themeMode ? parseThemeMode(payload.themeMode) : null;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: payload.fullName.trim(),
        email: nextEmail,
        country: payload.country.trim(),
        role: payload.role.trim(),
        ...(nextTheme ? { themeMode: nextTheme } : {}),
      },
    });

    return reply.send({
      ok: true,
      message: "Profile updated successfully.",
      user: serializeUser(updated),
    });
  });
};
