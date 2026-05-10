import { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "./prisma.js";
import { verifyAccessToken } from "./jwt.js";

const unauthorized = (reply: FastifyReply, message = "Unauthorized") => {
  reply.status(401).send({
    ok: false,
    message,
  });
};

export const getBearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
};

export const getOptionalAuthUser = async (request: FastifyRequest) => {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });
    return user;
  } catch {
    return null;
  }
};

export const requireAuthUser = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const token = getBearerToken(request);
  if (!token) {
    unauthorized(reply);
    return null;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      unauthorized(reply, "User account no longer exists.");
      return null;
    }

    return user;
  } catch {
    unauthorized(reply, "Your session has expired. Sign in again.");
    return null;
  }
};
