import { EventSourceType } from "@prisma/client";

import { env } from "../../config/env.js";
import { SourceSnippet } from "../../types/event.js";

interface SourceConfig {
  name: string;
  type: EventSourceType;
  url: string;
}

interface ParsedJsonLdEvent {
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  location?: string;
  city?: string;
  country?: string;
  venue?: string;
  imageUrl?: string;
  offers?: string;
  url?: string;
}

const EVENT_KEYWORDS = [
  "event",
  "meetup",
  "workshop",
  "summit",
  "conference",
  "hackathon",
  "webinar",
  "mentorship",
  "opportunity",
  "bootcamp",
  "tech",
];

const SAFE_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const joinSnippetLines = (lines: string[]): string => {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeWhitespace(line))
    .join("\n");
};

const stripHtml = (html: string): string => {
  const withoutScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  return normalizeWhitespace(
    decodeHtmlEntities(withoutScript.replace(/<[^>]+>/g, " ")),
  );
};

const safeUrl = (value: string, baseUrl?: string): string | null => {
  try {
    const resolved = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!SAFE_HTTP_PROTOCOLS.has(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
};

const maybeMetaContent = (
  html: string,
  field: "description" | "og:description" | "og:image" | "twitter:image" | "og:title",
): string | null => {
  const escapedField = field.replace(":", "\\:");
  const propertyRegex = new RegExp(
    `<meta[^>]+property=["']${escapedField}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const nameRegex = new RegExp(
    `<meta[^>]+name=["']${escapedField}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );

  const propertyMatch = html.match(propertyRegex);
  if (propertyMatch?.[1]) {
    return decodeHtmlEntities(propertyMatch[1].trim());
  }

  const nameMatch = html.match(nameRegex);
  if (nameMatch?.[1]) {
    return decodeHtmlEntities(nameMatch[1].trim());
  }

  return null;
};

const extractTitle = (html: string): string => {
  const ogTitle = maybeMetaContent(html, "og:title");
  if (ogTitle) {
    return ogTitle;
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) {
    return "Untitled Event Source";
  }

  return normalizeWhitespace(decodeHtmlEntities(titleMatch[1]));
};

const extractDescription = (html: string): string => {
  const description =
    maybeMetaContent(html, "description") ??
    maybeMetaContent(html, "og:description");

  if (description) {
    return normalizeWhitespace(description);
  }

  return "";
};

const extractImage = (html: string, pageUrl: string): string => {
  const image =
    maybeMetaContent(html, "og:image") ??
    maybeMetaContent(html, "twitter:image");
  if (image) {
    return safeUrl(image, pageUrl) ?? image;
  }

  const match = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (!match?.[1]) {
    return "";
  }

  return safeUrl(match[1], pageUrl) ?? "";
};

const extractAnchorLinks = (html: string, baseUrl: string): string[] => {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)];
  const deduped = new Set<string>();

  for (const match of matches) {
    const href = match[1]?.trim();
    if (!href) {
      continue;
    }
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("javascript:") ||
      href.startsWith("tel:")
    ) {
      continue;
    }

    const resolved = safeUrl(href, baseUrl);
    if (!resolved) {
      continue;
    }
    deduped.add(resolved);
  }

  return [...deduped];
};

const shouldConsiderLink = (link: string, baseUrl: string): boolean => {
  const lower = link.toLowerCase();
  if (EVENT_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return true;
  }

  try {
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
    const linkHost = new URL(link).hostname.replace(/^www\./, "");
    return linkHost.endsWith(baseHost);
  } catch {
    return false;
  }
};

const extractJsonLdBlocks = (html: string): unknown[] => {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed: unknown[] = [];

  for (const block of blocks) {
    const content = block[1]?.trim();
    if (!content) {
      continue;
    }

    try {
      parsed.push(JSON.parse(content));
    } catch {
      // skip invalid json-ld blocks
    }
  }

  return parsed;
};

const flattenJsonLdValues = (value: unknown): Record<string, unknown>[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLdValues(item));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const graph = record["@graph"];
  if (Array.isArray(graph)) {
    return [...flattenJsonLdValues(graph), record];
  }

  return [record];
};

const asString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

const parseJsonLdEvent = (record: Record<string, unknown>): ParsedJsonLdEvent | null => {
  const typeValue = record["@type"];
  const normalizedTypes = Array.isArray(typeValue)
    ? typeValue.map((item) => String(item).toLowerCase())
    : [String(typeValue ?? "").toLowerCase()];

  if (!normalizedTypes.some((item) => item.includes("event"))) {
    return null;
  }

  const title = asString(record.name);
  const description = asString(record.description) ?? "";
  const startDate = asString(record.startDate);
  if (!title || !startDate) {
    return null;
  }

  const image = Array.isArray(record.image)
    ? asString(record.image[0])
    : asString(record.image);
  const eventUrl = asString(record.url);
  const endDate = asString(record.endDate) ?? undefined;

  const locationRecord =
    typeof record.location === "object" && record.location
      ? (record.location as Record<string, unknown>)
      : null;

  const addressRecord =
    locationRecord &&
    typeof locationRecord.address === "object" &&
    locationRecord.address
      ? (locationRecord.address as Record<string, unknown>)
      : null;

  const venue = asString(locationRecord?.name) ?? undefined;
  const city = asString(addressRecord?.addressLocality) ?? undefined;
  const country = asString(addressRecord?.addressCountry) ?? undefined;
  const location = [venue, city, country].filter(Boolean).join(", ");

  const offerRecord = Array.isArray(record.offers)
    ? (record.offers[0] as Record<string, unknown>)
    : (record.offers as Record<string, unknown> | undefined);
  const offerPrice = asString(offerRecord?.price);
  const offerCurrency = asString(offerRecord?.priceCurrency);
  const offers =
    offerPrice && offerCurrency
      ? `${offerPrice} ${offerCurrency}`
      : offerPrice ?? undefined;

  return {
    title,
    description,
    startDate,
    endDate,
    location: location || undefined,
    venue,
    city,
    country,
    imageUrl: image ?? undefined,
    offers,
    url: eventUrl ?? undefined,
  };
};

const withTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.SCRAPE_REQUEST_TIMEOUT_MS,
  );

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchHtml = async (url: string): Promise<string | null> => {
  try {
    const response = await withTimeout((signal) =>
      fetch(url, {
        signal,
        headers: {
          "User-Agent":
            "EventScoutBot/1.0 (+https://eventscout.app; event discovery crawler)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }),
    );

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xml")) {
      return null;
    }

    return response.text();
  } catch {
    return null;
  }
};

const buildSnippetFromPage = (input: {
  sourceName: string;
  sourceType: EventSourceType;
  sourceUrl: string;
  pageUrl: string;
  html: string;
}): SourceSnippet => {
  const title = extractTitle(input.html);
  const description = extractDescription(input.html);
  const imageUrl = extractImage(input.html, input.pageUrl);
  const text = stripHtml(input.html).slice(0, 2400);

  return {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    sourceUrl: input.pageUrl,
    registrationUrl: input.pageUrl,
    imageUrl,
    rawText: joinSnippetLines([
      `Event: ${title}`,
      description ? `Summary: ${description}` : "",
      `Page URL: ${input.pageUrl}`,
      `Page Text: ${text}`,
    ]),
  };
};

const buildSnippetsFromJsonLd = (input: {
  sourceName: string;
  sourceType: EventSourceType;
  sourceUrl: string;
  pageUrl: string;
  html: string;
}): SourceSnippet[] => {
  const blocks = extractJsonLdBlocks(input.html);
  const allRecords = blocks.flatMap((item) => flattenJsonLdValues(item));

  return allRecords
    .map((record) => parseJsonLdEvent(record))
    .filter((event): event is ParsedJsonLdEvent => event !== null)
    .map((event) => {
      const city = event.city ?? "Remote";
      const country = event.country ?? "Global";
      const venue = event.venue ?? "TBA";
      const location = event.location ?? [city, country].join(", ");
      const endDate = event.endDate ?? event.startDate;
      const imageUrl = event.imageUrl
        ? safeUrl(event.imageUrl, input.pageUrl) ?? event.imageUrl
        : "";
      const registrationUrl = event.url
        ? safeUrl(event.url, input.pageUrl) ?? input.pageUrl
        : input.pageUrl;

      return {
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        registrationUrl,
        imageUrl,
        rawText: joinSnippetLines([
          `Event: ${event.title}`,
          `Date: ${event.startDate}`,
          `End: ${endDate}`,
          `City: ${city}`,
          `Country: ${country}`,
          `Venue: ${venue}`,
          event.offers ? `Price: ${event.offers}` : "",
          event.description ? `Summary: ${event.description}` : "",
        ]),
      } satisfies SourceSnippet;
    });
};

const dedupeSnippets = (snippets: SourceSnippet[]): SourceSnippet[] => {
  const seen = new Set<string>();
  const deduped: SourceSnippet[] = [];

  for (const snippet of snippets) {
    const key = `${snippet.sourceName}:${snippet.registrationUrl}:${snippet.rawText.slice(0, 120)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(snippet);
  }

  return deduped;
};

const scrapeSingleSource = async (source: SourceConfig): Promise<SourceSnippet[]> => {
  const rootHtml = await fetchHtml(source.url);
  if (!rootHtml) {
    return [];
  }

  const snippets: SourceSnippet[] = [
    ...buildSnippetsFromJsonLd({
      sourceName: source.name,
      sourceType: source.type,
      sourceUrl: source.url,
      pageUrl: source.url,
      html: rootHtml,
    }),
    buildSnippetFromPage({
      sourceName: source.name,
      sourceType: source.type,
      sourceUrl: source.url,
      pageUrl: source.url,
      html: rootHtml,
    }),
  ];

  const candidateLinks = extractAnchorLinks(rootHtml, source.url)
    .filter((link) => shouldConsiderLink(link, source.url))
    .slice(0, env.SCRAPE_MAX_LINKS_PER_SOURCE);

  const linkedPageResults = await Promise.allSettled(
    candidateLinks.map(async (link) => {
      const html = await fetchHtml(link);
      if (!html) {
        return [];
      }
      return [
        ...buildSnippetsFromJsonLd({
          sourceName: source.name,
          sourceType: source.type,
          sourceUrl: source.url,
          pageUrl: link,
          html,
        }),
        buildSnippetFromPage({
          sourceName: source.name,
          sourceType: source.type,
          sourceUrl: source.url,
          pageUrl: link,
          html,
        }),
      ];
    }),
  );

  for (const result of linkedPageResults) {
    if (result.status === "fulfilled") {
      snippets.push(...result.value);
    }
  }

  return dedupeSnippets(snippets);
};

export const scrapeSourcesForSnippets = async (
  sources: SourceConfig[],
): Promise<SourceSnippet[]> => {
  const scopedSources = sources.slice(0, env.SCRAPE_MAX_SOURCES_PER_RUN);
  const results = await Promise.allSettled(
    scopedSources.map((source) => scrapeSingleSource(source)),
  );

  const snippets: SourceSnippet[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      snippets.push(...result.value);
    }
  }

  return dedupeSnippets(snippets);
};
