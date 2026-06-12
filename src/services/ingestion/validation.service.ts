import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { EventCandidate } from "../../types/event.js";

interface ValidationRecord {
  id: string;
  isTechEvent: boolean;
  reliabilityScore: number;
  confidence: number;
  reason: string;
}

const TECH_TERMS = [
  "tech",
  "developer",
  "software",
  "engineering",
  "open source",
  "frontend",
  "backend",
  "mobile",
  "cloud",
  "devops",
  "data",
  "security",
  "ai",
  "machine learning",
  "startup",
];

const EVENT_TERMS = [
  "event",
  "meetup",
  "conference",
  "summit",
  "workshop",
  "webinar",
  "hackathon",
  "bootcamp",
  "mentorship",
  "session",
  "opportunity",
];

const LISTING_TITLE_PATTERNS = [
  "events calendar",
  "discover ",
  "find ",
  "all events",
  "events & activities",
  "technology events",
];

// Comprehensive list of African countries (common names and variants).
const AFRICAN_COUNTRIES = new Set([
  "nigeria", "kenya", "south africa", "ghana", "ethiopia", "tanzania",
  "uganda", "rwanda", "senegal", "egypt", "morocco", "tunisia", "algeria",
  "angola", "mozambique", "zambia", "zimbabwe", "cameroon", "ivory coast",
  "côte d'ivoire", "cote d'ivoire", "democratic republic of congo", "drc",
  "congo", "madagascar", "malawi", "botswana", "namibia", "mali",
  "burkina faso", "niger", "chad", "sudan", "south sudan", "eritrea",
  "djibouti", "somalia", "liberia", "sierra leone", "guinea", "guinea-bissau",
  "gambia", "cape verde", "cabo verde", "togo", "benin", "gabon",
  "equatorial guinea", "central african republic", "sao tome", "comoros",
  "mauritius", "seychelles", "lesotho", "eswatini", "swaziland", "burundi",
  "libya", "mauritania",
]);

// Major African cities and tech hubs.
const AFRICAN_CITIES = new Set([
  "lagos", "nairobi", "cape town", "johannesburg", "accra", "kampala",
  "addis ababa", "kigali", "dar es salaam", "cairo", "casablanca",
  "abidjan", "dakar", "harare", "luanda", "maputo", "lusaka", "abuja",
  "port harcourt", "ibadan", "enugu", "benin city", "calabar", "kumasi",
  "tamale", "mombasa", "kisumu", "arusha", "zanzibar", "jinja", "kano",
  "kaduna", "tunis", "algiers", "rabat", "fez", "marrakech", "alexandria",
  "giza", "pretoria", "durban", "soweto", "port elizabeth", "bloemfontein",
  "douala", "yaounde", "yaoundé", "lome", "lomé", "cotonou", "libreville",
  "brazzaville", "kinshasa", "antananarivo", "lilongwe", "blantyre",
  "windhoek", "gaborone", "victoria", "moroni", "banjul", "freetown",
  "monrovia", "conakry", "bissau", "bamako", "ouagadougou", "niamey",
  "ndjamena", "n'djamena", "khartoum", "juba", "asmara", "mogadishu",
  "tripoli", "nouakchott",
]);

// All recognised Africa-related terms for text-based detection.
const AFRICA_TERMS = new Set([
  "africa", "african",
  ...AFRICAN_COUNTRIES,
  ...AFRICAN_CITIES,
]);

const normalizeText = (value: string): string => {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
};

const includesAny = (text: string, terms: string[]): boolean => {
  return terms.some((term) => text.includes(term));
};

const safeDate = (value: string): Date | null => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const safeUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const canonicalUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return value.trim();
  }
};

const isLikelyListingOrDirectory = (candidate: EventCandidate): boolean => {
  const title = normalizeText(candidate.title);
  const sourceUrl = safeUrl(candidate.sourceUrl) ?? "";
  const registrationUrl = safeUrl(candidate.registrationUrl) ?? "";

  if (LISTING_TITLE_PATTERNS.some((pattern) => title.includes(pattern))) {
    return true;
  }

  if (registrationUrl.includes("lu.ma/") && registrationUrl.includes("?k=c")) {
    return true;
  }

  if (
    registrationUrl.includes("eventbrite.com/d/") ||
    registrationUrl.includes("meetup.com/find/")
  ) {
    return true;
  }

  if (registrationUrl === sourceUrl) {
    const path = (() => {
      try {
        return new URL(registrationUrl).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();

    if (
      path === "/" ||
      path.includes("/discover") ||
      path.includes("/calendar") ||
      path.includes("/events/")
    ) {
      return true;
    }
  }

  return false;
};

// Returns true if the event is located in Africa (or is an online event
// that clearly targets an African audience).
const isAfricanEvent = (candidate: EventCandidate): boolean => {
  const country = normalizeText(candidate.country);
  const city = normalizeText(candidate.city);

  if (AFRICAN_COUNTRIES.has(country)) return true;
  if (AFRICAN_CITIES.has(city)) return true;

  const combined = normalizeText(
    `${candidate.title} ${candidate.summary} ${candidate.description} ${candidate.city} ${candidate.country} ${candidate.location}`,
  );

  // For online/virtual events require an explicit Africa mention in the text.
  const isOnline =
    combined.includes("online") ||
    combined.includes("virtual") ||
    combined.includes("remote");

  return isOnline
    ? [...AFRICA_TERMS].some((term) => combined.includes(term))
    : [...AFRICA_TERMS].some((term) => combined.includes(term));
};

const normalizeTitle = (value: string): string => {
  return normalizeText(value).replace(/[^a-z0-9 ]+/g, "");
};

const buildBatchKey = (candidate: EventCandidate): string => {
  const start = safeDate(candidate.startDate);
  const day = start ? start.toISOString().slice(0, 10) : "unknown-date";
  const city = normalizeText(candidate.city || "remote");
  return `${normalizeTitle(candidate.title)}::${day}::${city}`;
};

const passesRuleValidation = (candidate: EventCandidate): boolean => {
  if (!candidate.title.trim() || candidate.title.trim().length < 6) {
    return false;
  }

  if (!candidate.summary.trim() || candidate.summary.trim().length < 10) {
    return false;
  }

  if (!safeUrl(candidate.sourceUrl) || !safeUrl(candidate.registrationUrl)) {
    return false;
  }

  if (isLikelyListingOrDirectory(candidate)) {
    return false;
  }

  const startDate = safeDate(candidate.startDate);
  if (!startDate) {
    return false;
  }

  // Only ingest events that start on or after January 1, 2026.
  const INGESTION_CUTOFF = new Date("2026-01-01");
  if (startDate < INGESTION_CUTOFF) {
    return false;
  }

  const combined = normalizeText(
    `${candidate.title} ${candidate.summary} ${candidate.description} ${candidate.tags.join(" ")}`,
  );

  if (!includesAny(combined, TECH_TERMS) || !includesAny(combined, EVENT_TERMS)) {
    return false;
  }

  // Only accept events that are in Africa or clearly target an African audience.
  if (!isAfricanEvent(candidate)) {
    return false;
  }

  return true;
};

const dedupeWithinBatch = (candidates: EventCandidate[]): EventCandidate[] => {
  const seen = new Set<string>();
  const deduped: EventCandidate[] = [];

  for (const candidate of candidates) {
    const registrationKey = canonicalUrl(candidate.registrationUrl);
    const sourceKey = canonicalUrl(candidate.sourceUrl);
    const batchKey = buildBatchKey(candidate);
    const keys = [registrationKey, sourceKey, batchKey];

    if (keys.some((key) => seen.has(key))) {
      continue;
    }

    keys.forEach((key) => seen.add(key));
    deduped.push(candidate);
  }

  return deduped;
};

const parseJsonArrayFromText = (input: string): unknown[] | null => {
  const start = input.indexOf("[");
  const end = input.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const maybeJson = input.slice(start, end + 1);
  try {
    const parsed = JSON.parse(maybeJson);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const validateWithGemini = async (
  candidates: EventCandidate[],
): Promise<Map<string, ValidationRecord>> => {
  if (!env.INGESTION_USE_AI_VALIDATION || !env.GEMINI_API_KEY || !candidates.length) {
    return new Map();
  }

  const chunkSize = 20;
  const validations = new Map<string, ValidationRecord>();

  for (let index = 0; index < candidates.length; index += chunkSize) {
    const chunk = candidates.slice(index, index + chunkSize);

    const prompt = `You are a strict tech-event validator for an Africa-focused events platform.
Return ONLY a JSON array and no prose.
For each event return: id, isTechEvent, reliabilityScore, confidence, reason
Rules:
1) Keep ONLY real technology-focused events physically taking place in an African country,
   OR online/virtual events run by an Africa-based organization or with a primary African audience.
2) Reject events located outside Africa unless they are clearly run by an African org for Africans.
3) Reject obvious ads, unrelated blog posts, and ambiguous/non-event content.
4) reliabilityScore and confidence must be numbers from 0 to 1.
Events:
${JSON.stringify(
  chunk.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    description: item.description,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    registrationUrl: item.registrationUrl,
    startDate: item.startDate,
    city: item.city,
    country: item.country,
    tags: item.tags,
    category: item.category,
  })),
)}`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        continue;
      }

      const records = parseJsonArrayFromText(text);
      if (!records) {
        continue;
      }

      for (const record of records) {
        if (!record || typeof record !== "object") {
          continue;
        }

        const value = record as Record<string, unknown>;
        const id = typeof value.id === "string" ? value.id : null;
        if (!id) {
          continue;
        }

        validations.set(id, {
          id,
          isTechEvent: Boolean(value.isTechEvent),
          reliabilityScore:
            typeof value.reliabilityScore === "number"
              ? Math.min(Math.max(value.reliabilityScore, 0), 1)
              : 0,
          confidence:
            typeof value.confidence === "number"
              ? Math.min(Math.max(value.confidence, 0), 1)
              : 0,
          reason:
            typeof value.reason === "string"
              ? value.reason.slice(0, 240)
              : "No reason provided",
        });
      }
    } catch {
      // AI validation is best-effort. Rule-based validation remains active.
    }
  }

  return validations;
};

const alignToExistingEventIds = async (
  candidates: EventCandidate[],
): Promise<EventCandidate[]> => {
  const aligned: EventCandidate[] = [];

  for (const candidate of candidates) {
    const start = safeDate(candidate.startDate) ?? new Date();
    const startOfDay = new Date(start);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(start);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await prisma.event.findFirst({
      where: {
        OR: [
          { registrationUrl: candidate.registrationUrl },
          { sourceUrl: candidate.sourceUrl },
          {
            AND: [
              {
                title: {
                  equals: candidate.title.trim(),
                  mode: "insensitive",
                },
              },
              {
                startDate: {
                  gte: startOfDay,
                  lte: endOfDay,
                },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });

    aligned.push(
      existing
        ? {
            ...candidate,
            id: existing.id,
          }
        : candidate,
    );
  }

  return aligned;
};

export const validateEventCandidates = async (
  candidates: EventCandidate[],
): Promise<EventCandidate[]> => {
  if (!candidates.length) {
    return [];
  }

  const ruleValid = dedupeWithinBatch(candidates).filter(passesRuleValidation);
  if (!ruleValid.length) {
    return [];
  }

  const aiValidations = await validateWithGemini(ruleValid);
  const aiFiltered = ruleValid.filter((candidate) => {
    const validation = aiValidations.get(candidate.id);
    if (!validation) {
      return true;
    }

    return (
      validation.isTechEvent &&
      validation.reliabilityScore >= env.INGESTION_VALIDATION_MIN_SCORE &&
      validation.confidence >= 0.55
    );
  });

  return alignToExistingEventIds(aiFiltered);
};
