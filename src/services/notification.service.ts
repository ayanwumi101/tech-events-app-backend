import { prisma } from "../lib/prisma.js";
import { sendPushNotification } from "./push.service.js";

interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  eventId?: string;
  push?: {
    enabled?: boolean;
    deepLink?: string;
  };
}

interface CreateNotificationForManyInput {
  userIds: string[];
  title: string;
  message: string;
  eventId?: string;
  deepLink?: string;
}

export const createNotificationForUser = async (
  input: CreateNotificationInput,
) => {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      message: input.message,
      eventId: input.eventId,
    },
  });

  if (input.push?.enabled === false) {
    return;
  }

  await sendPushNotification({
    userIds: [input.userId],
    title: input.title,
    body: input.message,
    data: input.push?.deepLink ? { deepLink: input.push.deepLink } : {},
  });
};

export const createNotificationForManyUsers = async (
  input: CreateNotificationForManyInput,
) => {
  const uniqueUserIds = [...new Set(input.userIds)];
  if (!uniqueUserIds.length) {
    return;
  }

  await prisma.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      title: input.title,
      message: input.message,
      eventId: input.eventId,
    })),
  });

  await sendPushNotification({
    userIds: uniqueUserIds,
    title: input.title,
    body: input.message,
    data: input.deepLink ? { deepLink: input.deepLink } : {},
  });
};
