import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthUser } from "../lib/auth-guard.js";
import { parseOrReply } from "../lib/request-validation.js";
import {
  registerPushToken,
  removePushToken,
  sendPushNotification,
} from "../services/push.service.js";

const registerSchema = z.object({
  token: z.string().min(8),
  platform: z.enum(["ios", "android", "web"]),
});

const removeSchema = z.object({
  token: z.string().min(8),
});

const testPushSchema = z.object({
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(240),
  deepLink: z.string().optional(),
});

export const registerPushRoutes = async (app: FastifyInstance) => {
  app.post("/push/register-token", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(registerSchema, request.body, reply);
    if (!payload) {
      return;
    }

    await registerPushToken({
      userId: user.id,
      token: payload.token.trim(),
      platform: payload.platform,
    });

    return reply.send({
      ok: true,
      message: "Push token registered.",
    });
  });

  app.delete("/push/register-token", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(removeSchema, request.body, reply);
    if (!payload) {
      return;
    }

    await removePushToken({
      userId: user.id,
      token: payload.token.trim(),
    });

    return reply.send({
      ok: true,
      message: "Push token removed.",
    });
  });

  app.post("/push/test", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(testPushSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const result = await sendPushNotification({
      userIds: [user.id],
      title: payload.title,
      body: payload.body,
      data: payload.deepLink ? { deepLink: payload.deepLink } : {},
    });

    return reply.send({
      ok: true,
      message: result.sent
        ? "Test push request sent."
        : "No device token found or push delivery failed.",
      requestedTokens: result.requestedTokens,
      sent: result.sent,
    });
  });
};
