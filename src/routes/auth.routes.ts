import { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../config/env.js";
import { requireAuthUser } from "../lib/auth-guard.js";
import {
  createSessionTokens,
  hashToken,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { parseThemeMode } from "../lib/mappers.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { parseOrReply } from "../lib/request-validation.js";
import { serializeUser } from "../lib/serializers.js";
import { sendOtpEmail } from "../services/email.service.js";

const signUpSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  country: z.string().min(2),
  role: z.string().min(2),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const emailSchema = z.object({
  email: z.string().email(),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(8),
});

const onboardingSchema = z.object({
  hasCompletedOnboarding: z.boolean(),
});

const themeSchema = z.object({
  themeMode: z.enum(["light", "dark"]),
});

const buildOtp = (): string => `${Math.floor(100000 + Math.random() * 900000)}`;

const createVerificationCode = async (userId: string) => {
  const otp = buildOtp();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.verificationCode.create({
    data: {
      userId,
      code: otp,
      expiresAt,
    },
  });

  return {
    otp,
    expiresAt,
  };
};

const createSession = async (userId: string) => {
  const { tokens, refreshTokenRecord } = createSessionTokens({ userId });

  await prisma.refreshToken.create({
    data: {
      id: refreshTokenRecord.id,
      userId,
      tokenHash: refreshTokenRecord.tokenHash,
      expiresAt: refreshTokenRecord.expiresAt,
    },
  });

  return tokens;
};

export const registerAuthRoutes = async (app: FastifyInstance) => {
  app.post("/auth/signup", async (request, reply) => {
    const payload = parseOrReply(signUpSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const email = payload.email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (existingUser?.emailVerified) {
      return reply.status(409).send({
        ok: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await hashPassword(payload.password);
    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          fullName: payload.fullName.trim(),
          email,
          passwordHash,
          country: payload.country.trim(),
          role: payload.role.trim(),
          emailVerified: false,
        },
      }));

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          fullName: payload.fullName.trim(),
          passwordHash,
          country: payload.country.trim(),
          role: payload.role.trim(),
        },
      });
    }

    await prisma.verificationCode.deleteMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
    });

    const verification = await createVerificationCode(user.id);
    const emailDelivery = await sendOtpEmail({
      toEmail: email,
      fullName: payload.fullName.trim(),
      otp: verification.otp,
      expiresInMinutes: env.OTP_EXPIRY_MINUTES,
    });

    return reply.send({
      ok: true,
      message: "Signup successful. Verify your email with the OTP code.",
      pendingVerification: {
        email,
        expiresAt: verification.expiresAt.toISOString(),
      },
      emailSent: emailDelivery.sent,
      emailReason: emailDelivery.reason,
      devOtpPreview:
        env.NODE_ENV === "production" && emailDelivery.sent
          ? undefined
          : verification.otp,
    });
  });

  app.post("/auth/resend-otp", async (request, reply) => {
    const payload = parseOrReply(emailSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase().trim() },
      select: { id: true, emailVerified: true, fullName: true, email: true },
    });

    if (!user || user.emailVerified) {
      return reply.status(404).send({
        ok: false,
        message: "No pending verification found for this email.",
      });
    }

    await prisma.verificationCode.deleteMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
    });

    const verification = await createVerificationCode(user.id);
    const emailDelivery = await sendOtpEmail({
      toEmail: user.email,
      fullName: user.fullName,
      otp: verification.otp,
      expiresInMinutes: env.OTP_EXPIRY_MINUTES,
    });

    return reply.send({
      ok: true,
      message: "A new OTP has been generated.",
      expiresAt: verification.expiresAt.toISOString(),
      emailSent: emailDelivery.sent,
      emailReason: emailDelivery.reason,
      devOtpPreview:
        env.NODE_ENV === "production" && emailDelivery.sent
          ? undefined
          : verification.otp,
    });
  });

  app.post("/auth/verify-email", async (request, reply) => {
    const payload = parseOrReply(verifyOtpSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase().trim() },
    });

    if (!user) {
      return reply.status(404).send({
        ok: false,
        message: "User not found for this verification request.",
      });
    }

    const code = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code: payload.otp.trim(),
        consumedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!code) {
      return reply.status(400).send({
        ok: false,
        message: "Invalid or expired OTP.",
      });
    }

    await prisma.$transaction([
      prisma.verificationCode.update({
        where: { id: code.id },
        data: { consumedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          lastLoginAt: new Date(),
        },
      }),
    ]);

    const session = await createSession(user.id);
    const refreshedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!refreshedUser) {
      return reply.status(404).send({
        ok: false,
        message: "User account no longer exists.",
      });
    }

    return reply.send({
      ok: true,
      message: "Email verified successfully.",
      user: serializeUser(refreshedUser),
      session,
    });
  });

  app.post("/auth/signin", async (request, reply) => {
    const payload = parseOrReply(signInSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase().trim() },
    });

    if (!user) {
      return reply.status(401).send({
        ok: false,
        message: "Invalid email or password.",
      });
    }

    const isValid = await verifyPassword(payload.password, user.passwordHash);
    if (!isValid) {
      return reply.status(401).send({
        ok: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.emailVerified) {
      return reply.status(403).send({
        ok: false,
        message: "Email is not verified yet.",
        requiresVerification: true,
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const session = await createSession(user.id);
    const refreshedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!refreshedUser) {
      return reply.status(404).send({
        ok: false,
        message: "User account no longer exists.",
      });
    }

    return reply.send({
      ok: true,
      message: "Signed in successfully.",
      user: serializeUser(refreshedUser),
      session,
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const payload = parseOrReply(refreshSchema, request.body, reply);
    if (!payload) {
      return;
    }

    try {
      const decoded = verifyRefreshToken(payload.refreshToken);
      const refreshRecord = await prisma.refreshToken.findUnique({
        where: { id: decoded.jti },
      });

      if (!refreshRecord) {
        return reply.status(401).send({
          ok: false,
          message: "Session is invalid. Please sign in again.",
        });
      }

      if (refreshRecord.revokedAt || refreshRecord.expiresAt <= new Date()) {
        return reply.status(401).send({
          ok: false,
          message: "Session expired. Please sign in again.",
        });
      }

      if (refreshRecord.tokenHash !== hashToken(payload.refreshToken)) {
        return reply.status(401).send({
          ok: false,
          message: "Session mismatch. Please sign in again.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: refreshRecord.userId },
      });
      if (!user) {
        return reply.status(404).send({
          ok: false,
          message: "User account no longer exists.",
        });
      }

      const { tokens, refreshTokenRecord } = createSessionTokens({
        userId: user.id,
      });

      await prisma.$transaction([
        prisma.refreshToken.update({
          where: { id: refreshRecord.id },
          data: { revokedAt: new Date() },
        }),
        prisma.refreshToken.create({
          data: {
            id: refreshTokenRecord.id,
            userId: user.id,
            tokenHash: refreshTokenRecord.tokenHash,
            expiresAt: refreshTokenRecord.expiresAt,
          },
        }),
      ]);

      return reply.send({
        ok: true,
        message: "Session refreshed.",
        user: serializeUser(user),
        session: tokens,
      });
    } catch {
      return reply.status(401).send({
        ok: false,
        message: "Invalid refresh token.",
      });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const body = request.body as { refreshToken?: string } | undefined;

    if (body?.refreshToken) {
      try {
        const decoded = verifyRefreshToken(body.refreshToken);
        await prisma.refreshToken.updateMany({
          where: {
            id: decoded.jti,
            userId: user.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      } catch {
        // Ignore invalid token during logout
      }
    } else {
      await prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    return reply.send({
      ok: true,
      message: "Signed out successfully.",
    });
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    return reply.send({
      ok: true,
      user: serializeUser(user),
    });
  });

  app.patch("/auth/onboarding", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(onboardingSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        onboardingCompleted: payload.hasCompletedOnboarding,
      },
    });

    return reply.send({
      ok: true,
      message: "Onboarding status updated.",
      user: serializeUser(updated),
    });
  });

  app.patch("/auth/theme", async (request, reply) => {
    const user = await requireAuthUser(request, reply);
    if (!user) {
      return;
    }

    const payload = parseOrReply(themeSchema, request.body, reply);
    if (!payload) {
      return;
    }

    const nextTheme = parseThemeMode(payload.themeMode);
    if (!nextTheme) {
      return reply.status(400).send({
        ok: false,
        message: "Unsupported theme mode.",
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        themeMode: nextTheme,
      },
    });

    return reply.send({
      ok: true,
      message: "Theme preference saved.",
      user: serializeUser(updated),
    });
  });
};
