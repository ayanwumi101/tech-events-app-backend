import { prisma } from "../lib/prisma.js";

interface SendPushInput {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface SendPushSummary {
  requestedTokens: number;
  sent: boolean;
}

export const registerPushToken = async (input: {
  userId: string;
  token: string;
  platform: string;
}) => {
  return prisma.pushToken.upsert({
    where: { token: input.token },
    create: {
      userId: input.userId,
      token: input.token,
      platform: input.platform,
    },
    update: {
      userId: input.userId,
      platform: input.platform,
    },
  });
};

export const removePushToken = async (input: {
  userId: string;
  token: string;
}) => {
  return prisma.pushToken.deleteMany({
    where: {
      userId: input.userId,
      token: input.token,
    },
  });
};

export const sendPushNotification = async (
  input: SendPushInput,
): Promise<SendPushSummary> => {
  const tokens = await prisma.pushToken.findMany({
    where: {
      userId: {
        in: input.userIds,
      },
    },
    select: { token: true },
  });

  if (!tokens.length) {
    return {
      requestedTokens: 0,
      sent: false,
    };
  }

  const body = tokens.map((entry) => ({
    to: entry.token,
    title: input.title,
    body: input.body,
    data: input.data ?? {},
    sound: "default",
  }));

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    return {
      requestedTokens: tokens.length,
      sent: true,
    };
  } catch {
    return {
      requestedTokens: tokens.length,
      sent: false,
    };
  }
};
