import {
  EventCategory,
  EventSourceType,
  IngestionStatus,
} from "@prisma/client";

import { env } from "../../config/env.js";
import { parseEventCategory, parseSourceType } from "../../lib/mappers.js";
import { prisma } from "../../lib/prisma.js";
import { createNotificationForManyUsers } from "../notification.service.js";
import { uploadImageToCloudinary } from "../cloudinary.service.js";
import { EventCandidate } from "../../types/event.js";
import { collectExternalSourceSnippets } from "./discovery.service.js";
import { extractEventsFromSnippets } from "./extractor.js";
import { defaultAiSources } from "./sources.js";
import { scrapeSourcesForSnippets } from "./scraper.js";
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

const toSafeDate = (input: string, fallback: Date): Date => {
  const candidate = new Date(input);
  if (Number.isNaN(candidate.getTime())) {
    return fallback;
  }
  return candidate;
};

const dedupeSnippets = <
  TSnippet extends {
    sourceName: string;
    registrationUrl: string;
    rawText: string;
  },
>(
  snippets: TSnippet[],
): TSnippet[] => {
  const seen = new Set<string>();
  const deduped: TSnippet[] = [];

  for (const snippet of snippets) {
    const key = `${snippet.sourceName}:${snippet.registrationUrl}:${snippet.rawText.slice(0, 180)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(snippet);
  }

  return deduped;
};

const upsertEvent = async (event: EventCandidate): Promise<"created" | "updated"> => {
  const existing = await prisma.event.findUnique({
    where: { id: event.id },
    select: { id: true, imageUrl: true },
  });

  const now = new Date();
  const startDate = toSafeDate(event.startDate, now);
  const endDate = toSafeDate(event.endDate, startDate);

  const shouldUploadImage =
    Boolean(event.imageUrl) &&
    !event.imageUrl.includes("res.cloudinary.com") &&
    (!existing?.imageUrl || existing.imageUrl !== event.imageUrl);
  const imageUrl = shouldUploadImage
    ? await uploadImageToCloudinary(event.imageUrl)
    : event.imageUrl;

  await prisma.event.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      title: event.title,
      summary: event.summary,
      description: event.description,
      category: normalizeCategory(event.category),
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

const buildSnippets = async () => {
  await ensureSources();

  const dbSources = await prisma.aiSource.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const scraped = await scrapeSourcesForSnippets(
    dbSources.map((source) => ({
      name: source.name,
      type: source.type,
      url: source.url,
    })),
  );

  const external = await collectExternalSourceSnippets();
  const merged = dedupeSnippets([...external, ...scraped]);
  return merged.slice(0, 80);
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
      provider: env.AI_PROVIDER,
    },
  });

  try {
    const snippets = await buildSnippets();
    const extracted = await extractEventsFromSnippets(snippets);
    const validated = await validateEventCandidates(extracted);

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

    await createDiscoveryNotifications(discoveredIds);

    const endedAt = new Date();
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: IngestionStatus.COMPLETED,
        endedAt,
        discovered,
        updated,
        sourceCount: snippets.length,
      },
    });

    return {
      runId: run.id,
      provider: env.AI_PROVIDER,
      discovered,
      updated,
      sourceCount: snippets.length,
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
