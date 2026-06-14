import {
  EventCategory,
  EventSourceType,
  EventStatus,
  IngestionStatus,
} from "@prisma/client";

import { env } from "../../config/env.js";
import { parseEventCategory, parseSourceType } from "../../lib/mappers.js";
import { prisma } from "../../lib/prisma.js";
import { createNotificationForManyUsers } from "../notification.service.js";
import { uploadImageToCloudinary } from "../cloudinary.service.js";
import { EventCandidate } from "../../types/event.js";
import { defaultAiSources } from "./sources.js";
import { runTavilyTechEventIngestion } from "./tavily-ingestion.service.js";
import { validateEventCandidates } from "./validation.service.js";

interface IngestionSummary {
  runId: string;
  provider: string;
  discovered: number;
  updated: number;
  sourceCount: number;
  startedAt: string;
  endedAt: string;
}

const normalizeCategory = (value: string): EventCategory => {
  return parseEventCategory(value) ?? "COMMUNITY";
};

const normalizeSourceType = (value: string): EventSourceType => {
  return parseSourceType(value) ?? "WEBSITE";
};

const computeEventStatus = (startDate: Date, endDate: Date): EventStatus => {
  const now = new Date();
  if (endDate < now) return "EXPIRED";
  if (startDate <= now) return "ONGOING";
  return "UPCOMING";
};

const toSafeDate = (input: string, fallback: Date): Date => {
  const candidate = new Date(input);
  if (Number.isNaN(candidate.getTime())) {
    return fallback;
  }
  return candidate;
};

const upsertEvent = async (event: EventCandidate): Promise<"created" | "updated"> => {
  const existing = await prisma.event.findUnique({
    where: { id: event.id },
    select: { id: true, imageUrl: true },
  });

  const now = new Date();
  const startDate = toSafeDate(event.startDate, now);
  const endDate = toSafeDate(event.endDate, startDate);
  const status = computeEventStatus(startDate, endDate);

  const effectiveImageUrl =
    event.imageUrl?.trim() || env.EVENT_PLACEHOLDER_IMAGE_URL;

  const shouldUploadImage =
    Boolean(effectiveImageUrl) &&
    !effectiveImageUrl.includes("res.cloudinary.com") &&
    (!existing?.imageUrl || existing.imageUrl !== effectiveImageUrl);
  const imageUrl = shouldUploadImage
    ? await uploadImageToCloudinary(effectiveImageUrl)
    : effectiveImageUrl;

  await prisma.event.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      title: event.title,
      summary: event.summary,
      description: event.description,
      category: normalizeCategory(event.category),
      status,
      sourceType: normalizeSourceType(event.sourceType),
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
      registrationUrl: event.registrationUrl,
      location: event.location,
      venue: event.venue,
      city: event.city,
      country: event.country,
      startDate,
      endDate,
      imageUrl,
      tags: event.tags,
      priceLabel: event.priceLabel,
      attendeeEstimate: event.attendeeEstimate,
      aiConfidence: event.aiConfidence,
      aiSummary: event.aiSummary,
      ingestedAt: now,
    },
    update: {
      title: event.title,
      summary: event.summary,
      description: event.description,
      category: normalizeCategory(event.category),
      status,
      sourceType: normalizeSourceType(event.sourceType),
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
      registrationUrl: event.registrationUrl,
      location: event.location,
      venue: event.venue,
      city: event.city,
      country: event.country,
      startDate,
      endDate,
      imageUrl,
      tags: event.tags,
      priceLabel: event.priceLabel,
      attendeeEstimate: event.attendeeEstimate,
      aiConfidence: event.aiConfidence,
      aiSummary: event.aiSummary,
      ingestedAt: now,
    },
  });

  return existing ? "updated" : "created";
};

// Bulk-update the status of all persisted events based on current time.
// Called at the end of each ingestion run so statuses stay accurate even between runs.
const refreshEventStatuses = async (): Promise<void> => {
  const now = new Date();

  await Promise.all([
    // Mark events whose end date has passed as EXPIRED (unless manually CANCELLED).
    prisma.$executeRaw`
      UPDATE "Event"
      SET "status" = 'EXPIRED'::"EventStatus", "updatedAt" = ${now}
      WHERE "endDate" < ${now}
        AND "status" NOT IN ('CANCELLED'::"EventStatus", 'EXPIRED'::"EventStatus")
    `,
    // Mark events currently in-progress as ONGOING.
    prisma.$executeRaw`
      UPDATE "Event"
      SET "status" = 'ONGOING'::"EventStatus", "updatedAt" = ${now}
      WHERE "startDate" <= ${now} AND "endDate" >= ${now}
        AND "status" NOT IN ('CANCELLED'::"EventStatus", 'ONGOING'::"EventStatus")
    `,
    // Restore UPCOMING for events whose start date is in the future (e.g. re-scheduled).
    prisma.$executeRaw`
      UPDATE "Event"
      SET "status" = 'UPCOMING'::"EventStatus", "updatedAt" = ${now}
      WHERE "startDate" > ${now}
        AND "status" NOT IN ('CANCELLED'::"EventStatus", 'UPCOMING'::"EventStatus")
    `,
  ]);
};

const ensureSources = async (): Promise<number> => {
  const sourceCount = await prisma.aiSource.count({
    where: { isActive: true },
  });

  if (sourceCount > 0) {
    return sourceCount;
  }

  await prisma.aiSource.createMany({
    data: defaultAiSources.map((source) => ({
      name: source.name,
      type: source.type,
      url: source.url,
      isActive: true,
    })),
  });

  return defaultAiSources.length;
};

const getActiveSources = async () => {
  await ensureSources();

  return prisma.aiSource.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
};

const createDiscoveryNotifications = async (newEventIds: string[]) => {
  if (!newEventIds.length) {
    return;
  }

  const users = await prisma.user.findMany({
    select: { id: true },
  });
  if (!users.length) {
    return;
  }

  const discoveredEvents = await prisma.event.findMany({
    where: {
      id: {
        in: newEventIds,
      },
    },
    select: {
      id: true,
      title: true,
      sourceName: true,
    },
    take: 3,
  });

  await createNotificationForManyUsers({
    userIds: users.map((user) => user.id),
    title: "New event discovered",
    message: `${discoveredEvents.length} new event${discoveredEvents.length > 1 ? "s" : ""} were added to your feed.`,
    deepLink: "eventscout://(app)/(tabs)/events",
  });

  await prisma.notification.createMany({
    data: users.flatMap((user) =>
      discoveredEvents.map((event) => ({
        userId: user.id,
        eventId: event.id,
        title: "Event added",
        message: `${event.title} from ${event.sourceName} was discovered.`,
      })),
    ),
  });
};

export const runIngestionScan = async (): Promise<IngestionSummary> => {
  const startedAt = new Date();
  const run = await prisma.ingestionRun.create({
    data: {
      status: IngestionStatus.RUNNING,
      provider: "tavily+gemini",
    },
  });

  try {
    const sources = await getActiveSources();
    const ingestion = await runTavilyTechEventIngestion(
      sources.map((source) => ({
        name: source.name,
        type: source.type,
        url: source.url,
      })),
    );
    const validated = await validateEventCandidates(ingestion.candidates);

    let discovered = 0;
    let updated = 0;
    const discoveredIds: string[] = [];

    for (const event of validated) {
      const result = await upsertEvent(event);
      if (result === "created") {
        discovered += 1;
        discoveredIds.push(event.id);
      } else {
        updated += 1;
      }
    }

    await prisma.aiSource.updateMany({
      where: { isActive: true },
      data: { lastFetchedAt: new Date() },
    });

    await refreshEventStatuses();
    await createDiscoveryNotifications(discoveredIds);

    const endedAt = new Date();
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: IngestionStatus.COMPLETED,
        endedAt,
        discovered,
        updated,
        sourceCount: ingestion.sourceCount,
      },
    });

    return {
      runId: run.id,
      provider: "tavily+gemini",
      discovered,
      updated,
      sourceCount: ingestion.sourceCount,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    };
  } catch (error) {
    const endedAt = new Date();
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: IngestionStatus.FAILED,
        endedAt,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
};
