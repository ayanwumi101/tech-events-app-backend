import { GoogleGenAI } from "@google/genai";
import {
  tavily,
  type TavilyExtractResponse,
} from "@tavily/core";
import { EventSourceType } from "@prisma/client";

import { env } from "../../config/env.js";
import { EventCandidate } from "../../types/event.js";

interface TavilySource {
  name: string;
  type: EventSourceType;
  url: string;
}

interface RawSourceContext {
  sourceName: string;
  sourceType: EventCandidate["sourceType"];
  sourceUrl: string;
  title: string;
  rawText: string;
  imageUrls: string[];
  origin: "search" | "extract";
}

type TavilyExtractResult = TavilyExtractResponse["results"][number];

export interface TavilyIngestionResult {
  candidates: EventCandidate[];
  sourceCount: number;
}

const TAVILY_EXTRACT_BATCH_SIZE = 20;
const MAX_CONTEXT_ITEMS = 48;
const MAX_CONTEXT_CHARS_PER_ITEM = 2800;
const MAX_TOTAL_CONTEXT_CHARS = 110_000;

const tvly = tavily(
  env.TAVILY_API_KEY
    ? {
        apiKey: env.TAVILY_API_KEY,
      }
    : undefined,
);

const ai = env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
  : null;

const SOURCE_TYPE_BY_HOST: Array<{
  hostPattern: string;
  sourceType: EventCandidate["sourceType"];
}> = [
  { hostPattern: "x.com", sourceType: "SOCIAL_MEDIA" },
  { hostPattern: "twitter.com", sourceType: "SOCIAL_MEDIA" },
  { hostPattern: "linkedin.com", sourceType: "SOCIAL_MEDIA" },
  { hostPattern: "meetup.com", sourceType: "COMMUNITY" },
  { hostPattern: "lu.ma", sourceType: "COMMUNITY" },
  { hostPattern: "gdg.community.dev", sourceType: "COMMUNITY" },
  { hostPattern: "eventbrite.", sourceType: "WEBSITE" },
];

const allowedCategories = new Set<EventCandidate["category"]>([
  "AI",
  "CLOUD",
  "SECURITY",
  "FRONTEND",
  "MOBILE",
  "DATA",
  "DEVOPS",
  "COMMUNITY",
]);

const allowedSourceTypes = new Set<EventCandidate["sourceType"]>([
  "SOCIAL_MEDIA",
  "WEBSITE",
  "NEWSLETTER",
  "COMMUNITY",
]);

const normalizeUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const getHostname = (value: string): string => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-source";
  }
};

const inferSourceType = (
  url: string,
  fallback: EventCandidate["sourceType"] = "WEBSITE",
): EventCandidate["sourceType"] => {
  const host = getHostname(url).toLowerCase();
  return (
    SOURCE_TYPE_BY_HOST.find((item) => host.includes(item.hostPattern))
      ?.sourceType ?? fallback
  );
};

const toCandidateSourceType = (
  sourceType: EventSourceType,
): EventCandidate["sourceType"] => {
  return sourceType;
};

const sourceNameFromUrl = (value: string): string => {
  const host = getHostname(value);
  return host === "unknown-source" ? "Tavily Web Search" : host;
};

const truncate = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const uniqueBy = <T>(items: T[], keyFactory: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFactory(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
};

const buildSearchQueries = (): string[] => [
  'site:x.com OR site:lu.ma ("tech meetup" OR hackathon OR workshop OR "developer event") Africa 2026',
  '("tech conference" OR "startup event" OR "developer meetup") (Lagos OR Nairobi OR Accra OR Kigali OR "Cape Town") 2026',
  'site:eventbrite.com OR site:meetup.com ("technology events" OR "software engineering") Africa 2026',
  'site:gdg.community.dev Africa ("DevFest" OR "Google Developer Group" OR "tech event") 2026',
  '("AI meetup" OR "data science workshop" OR "cloud community") Africa upcoming event',
];

const searchTavily = async (): Promise<RawSourceContext[]> => {
  const responses = await Promise.allSettled(
    buildSearchQueries().map((query) =>
      tvly.search(query, {
        searchDepth: "advanced",
        maxResults: 8,
        includeImages: true,
        includeImageDescriptions: true,
        includeRawContent: "text",
        timeRange: "month",
        timeout: env.SCRAPE_REQUEST_TIMEOUT_MS,
      }),
    ),
  );

  const contexts: RawSourceContext[] = [];

  for (const response of responses) {
    if (response.status !== "fulfilled") {
      continue;
    }

    const responseImages = response.value.images
      .map((image) => normalizeUrl(image.url))
      .filter((url): url is string => Boolean(url))
      .slice(0, 4);

    for (const result of response.value.results) {
      const sourceUrl = normalizeUrl(result.url);
      if (!sourceUrl) {
        continue;
      }

      contexts.push({
        sourceName: result.title || sourceNameFromUrl(sourceUrl),
        sourceType: inferSourceType(sourceUrl),
        sourceUrl,
        title: result.title,
        rawText: [result.content, result.rawContent]
          .filter(Boolean)
          .join("\n\n"),
        imageUrls: responseImages,
        origin: "search",
      });
    }
  }

  return uniqueBy(contexts, (item) => item.sourceUrl);
};

const mapExtractResultToContext = (
  result: TavilyExtractResult,
  sourcesByUrl: Map<string, TavilySource>,
): RawSourceContext | null => {
  const sourceUrl = normalizeUrl(result.url);
  if (!sourceUrl || !result.rawContent?.trim()) {
    return null;
  }

  const configuredSource = sourcesByUrl.get(sourceUrl);
  const imageUrls = (result.images ?? [])
    .map((imageUrl) => normalizeUrl(imageUrl))
    .filter((imageUrl): imageUrl is string => Boolean(imageUrl))
    .slice(0, 5);

  return {
    sourceName:
      configuredSource?.name ?? result.title ?? sourceNameFromUrl(sourceUrl),
    sourceType: configuredSource
      ? toCandidateSourceType(configuredSource.type)
      : inferSourceType(sourceUrl),
    sourceUrl,
    title: result.title ?? configuredSource?.name ?? sourceNameFromUrl(sourceUrl),
    rawText: result.rawContent,
    imageUrls,
    origin: "extract",
  };
};

const extractTavily = async (
  sources: TavilySource[],
  discoveredUrls: string[],
): Promise<RawSourceContext[]> => {
  const sourceUrls = sources
    .map((source) => normalizeUrl(source.url))
    .filter((url): url is string => Boolean(url));
  const maxExtractUrls = Math.min(
    Math.max(env.SCRAPE_MAX_SOURCES_PER_RUN, TAVILY_EXTRACT_BATCH_SIZE),
    60,
  );
  const urls = uniqueBy([...sourceUrls, ...discoveredUrls], (url) => url).slice(
    0,
    maxExtractUrls,
  );
  const sourcesByUrl = new Map(
    sources
      .map((source) => {
        const url = normalizeUrl(source.url);
        return url ? ([url, source] as const) : null;
      })
      .filter((item): item is readonly [string, TavilySource] => Boolean(item)),
  );
  const contexts: RawSourceContext[] = [];

  for (const urlBatch of chunk(urls, TAVILY_EXTRACT_BATCH_SIZE)) {
    try {
      const response = await tvly.extract(urlBatch, {
        extractDepth: "advanced",
        format: "text",
        includeImages: true,
        timeout: env.SCRAPE_REQUEST_TIMEOUT_MS,
      });

      response.results.forEach((result) => {
        const context = mapExtractResultToContext(result, sourcesByUrl);
        if (context) {
          contexts.push(context);
        }
      });
    } catch {
      // A failed extract batch should not discard search discoveries.
    }
  }

  return uniqueBy(contexts, (item) => item.sourceUrl);
};

const buildGeminiContext = (contexts: RawSourceContext[]): string => {
  let totalChars = 0;
  const compact = contexts.slice(0, MAX_CONTEXT_ITEMS).map((context, index) => {
    const rawText = truncate(context.rawText, MAX_CONTEXT_CHARS_PER_ITEM);
    totalChars += rawText.length;

    return {
      index,
      sourceName: context.sourceName,
      sourceType: context.sourceType,
      sourceUrl: context.sourceUrl,
      title: context.title,
      origin: context.origin,
      imageUrls: context.imageUrls,
      rawText,
    };
  });

  if (totalChars <= MAX_TOTAL_CONTEXT_CHARS) {
    return JSON.stringify(compact);
  }

  let runningTotal = 0;
  const bounded = compact
    .map((item) => {
      if (runningTotal >= MAX_TOTAL_CONTEXT_CHARS) {
        return null;
      }

      const remaining = MAX_TOTAL_CONTEXT_CHARS - runningTotal;
      const rawText = truncate(item.rawText, remaining);
      runningTotal += rawText.length;
      return {
        ...item,
        rawText,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return JSON.stringify(bounded);
};

const buildGeminiPrompt = (contexts: RawSourceContext[]): string => {
  return `You are EventScout's strict event ingestion engine.
Analyze the Tavily web search and extracted website context below.

Extract ONLY real, credible technology events, tech meetups, workshops, conferences, mentorship sessions, hackathons, bootcamps, startup/demo days, and tech opportunities.
The target geography is Africa: include events physically in an African country, or online events clearly organized by an Africa-based organization or primarily for African tech communities.

Return ONLY a valid JSON array. Do not include markdown or prose.
Each item must match this exact shape:
{
  "title": "Event name",
  "summary": "One sentence summary",
  "description": "Useful event description",
  "category": "AI | CLOUD | SECURITY | FRONTEND | MOBILE | DATA | DEVOPS | COMMUNITY",
  "sourceType": "SOCIAL_MEDIA | WEBSITE | NEWSLETTER | COMMUNITY",
  "sourceName": "Source or organizer name",
  "sourceUrl": "URL where the event was found",
  "registrationUrl": "Most direct registration/source URL",
  "location": "City, Country or Online - Country",
  "venue": "Venue name, Online, or TBA",
  "city": "City or Online",
  "country": "African country most relevant to the event",
  "startDate": "ISO-8601 datetime",
  "endDate": "ISO-8601 datetime",
  "imageUrl": "Best event image URL from source context, or empty string",
  "tags": ["tech", "meetup"],
  "priceLabel": "Free, Paid, TBA, or exact price",
  "attendeeEstimate": 150,
  "aiConfidence": 0.85,
  "aiSummary": "Short reason this is a reliable African tech event"
}

Strict rules:
- Omit entries that lack a real event name, date, and African location/audience.
- Omit generic event directories, category listing pages, ordinary blog posts, and vague announcements without a date.
- Prefer direct registration URLs over directory URLs.
- Use 2026 for dates when month/day is explicit but year is omitted.
- Do not invent events. Only extract events supported by the context.
- If endDate is unknown, set it two hours after startDate.
- If imageUrl is unavailable, return an empty string.

Tavily context:
${buildGeminiContext(contexts)}`;
};

const parseJsonArray = (input: string): unknown[] => {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = input.indexOf("[");
    const end = input.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return [];
    }

    try {
      const parsed = JSON.parse(input.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
};

const safeString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const safeNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const safeDate = (value: unknown): Date | null => {
  const stringValue = safeString(value);
  if (!stringValue) {
    return null;
  }

  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const safeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

const inferCategory = (rawText: string): EventCandidate["category"] => {
  const text = rawText.toLowerCase();
  if (text.includes("kubernetes") || text.includes("cloud")) return "CLOUD";
  if (text.includes("security") || text.includes("cyber")) return "SECURITY";
  if (text.includes("frontend") || text.includes("react")) return "FRONTEND";
  if (text.includes("mobile") || text.includes("react native")) return "MOBILE";
  if (text.includes("data")) return "DATA";
  if (text.includes("devops")) return "DEVOPS";
  if (text.includes("ai") || text.includes("machine learning")) return "AI";
  return "COMMUNITY";
};

const findRelatedContext = (
  raw: Record<string, unknown>,
  contexts: RawSourceContext[],
): RawSourceContext | null => {
  const urls = [
    safeString(raw.registrationUrl),
    safeString(raw.platform_source_url),
    safeString(raw.sourceUrl),
  ]
    .map((url) => normalizeUrl(url))
    .filter((url): url is string => Boolean(url));

  return (
    contexts.find((context) => urls.includes(context.sourceUrl)) ??
    contexts.find((context) =>
      urls.some((url) => getHostname(url) === getHostname(context.sourceUrl)),
    ) ??
    null
  );
};

const normalizeGeminiEvent = (
  raw: unknown,
  contexts: RawSourceContext[],
): EventCandidate | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const relatedContext = findRelatedContext(value, contexts);
  const title = safeString(value.title) || safeString(value.event_name);
  const city = safeString(value.city) || "Online";
  const country = safeString(value.country);
  const startDate = safeDate(value.startDate) ?? safeDate(value.date);

  if (!title || !country || !startDate) {
    return null;
  }

  const endDate =
    safeDate(value.endDate) ??
    new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const sourceUrl =
    normalizeUrl(safeString(value.sourceUrl)) ??
    normalizeUrl(safeString(value.platform_source_url)) ??
    relatedContext?.sourceUrl ??
    null;
  const registrationUrl =
    normalizeUrl(safeString(value.registrationUrl)) ?? sourceUrl;

  if (!sourceUrl || !registrationUrl) {
    return null;
  }

  const combinedText = `${title} ${safeString(value.summary)} ${safeString(
    value.description,
  )} ${relatedContext?.rawText ?? ""}`;
  const rawCategory = safeString(value.category).toUpperCase();
  const category = allowedCategories.has(rawCategory as EventCandidate["category"])
    ? (rawCategory as EventCandidate["category"])
    : inferCategory(combinedText);
  const rawSourceType = safeString(value.sourceType).toUpperCase();
  const sourceType = allowedSourceTypes.has(
    rawSourceType as EventCandidate["sourceType"],
  )
    ? (rawSourceType as EventCandidate["sourceType"])
    : relatedContext?.sourceType ?? inferSourceType(sourceUrl);
  const imageUrl =
    normalizeUrl(safeString(value.imageUrl)) ??
    relatedContext?.imageUrls[0] ??
    env.EVENT_PLACEHOLDER_IMAGE_URL;
  const tags = safeTags(value.tags);
  const summary =
    safeString(value.summary) ||
    `A technology event discovered from ${relatedContext?.sourceName ?? sourceNameFromUrl(sourceUrl)}.`;

  return {
    id: `${slugify(title)}-${startDate.toISOString().slice(0, 10)}-${slugify(city)}`,
    title,
    summary,
    description: safeString(value.description) || summary,
    category,
    sourceType,
    sourceName:
      safeString(value.sourceName) ||
      relatedContext?.sourceName ||
      sourceNameFromUrl(sourceUrl),
    sourceUrl,
    registrationUrl,
    location:
      safeString(value.location) ||
      (city.toLowerCase() === "online" ? `Online - ${country}` : `${city}, ${country}`),
    venue: safeString(value.venue) || (city.toLowerCase() === "online" ? "Online" : "TBA"),
    city,
    country,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    imageUrl,
    tags: tags.length ? tags : [category.toLowerCase(), "tech", "africa"],
    priceLabel: safeString(value.priceLabel) || "TBA",
    attendeeEstimate: Math.round(safeNumber(value.attendeeEstimate, 150)),
    aiConfidence: Math.min(Math.max(safeNumber(value.aiConfidence, 0.82), 0), 1),
    aiSummary:
      safeString(value.aiSummary) ||
      "Structured from Tavily search/extract context using Gemini.",
  };
};

const extractEventsWithGemini = async (
  contexts: RawSourceContext[],
): Promise<EventCandidate[]> => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is required for Tavily ingestion.");
  }

  if (!contexts.length) {
    return [];
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: buildGeminiPrompt(contexts),
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Empty response received from Gemini API.");
  }

  return parseJsonArray(text)
    .map((item) => normalizeGeminiEvent(item, contexts))
    .filter((item): item is EventCandidate => Boolean(item));
};

export const runTavilyTechEventIngestion = async (
  sources: TavilySource[],
): Promise<TavilyIngestionResult> => {
  const searchedContexts = await searchTavily();
  const extractedContexts = await extractTavily(
    sources,
    searchedContexts.map((context) => context.sourceUrl),
  );
  const contexts = uniqueBy(
    [...extractedContexts, ...searchedContexts].filter((context) =>
      context.rawText.trim(),
    ),
    (context) => context.sourceUrl,
  );
  const candidates = await extractEventsWithGemini(contexts);

  return {
    candidates,
    sourceCount: contexts.length,
  };
};
