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

  const startDate = safeDate(candidate.startDate);
  if (!startDate) {
    return false;
  }

  const now = Date.now();
  if (startDate.getTime() < now - 1000 * 60 * 60 * 24 * 3) {
    return false;
  }

  const combined = normalizeText(
    `${candidate.title} ${candidate.summary} ${candidate.description} ${candidate.tags.join(" ")}`,
  );

  return includesAny(combined, TECH_TERMS) && includesAny(combined, EVENT_TERMS);
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

    const prompt = `You are a strict tech-event validator.
Return ONLY a JSON array and no prose.
For each event return:
id,isTechEvent,reliabilityScore,confidence,reason
Rules:
1) Keep only real technology-focused events/opportunities.
2) Reject obvious ads, unrelated blog posts, and ambiguous/non-event content.
3) reliabilityScore and confidence must be numbers from 0 to 1.
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

