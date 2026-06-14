import { config } from "dotenv";
import { z } from "zod";

import { parseDurationToSeconds } from "../lib/time.js";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
  CLIENT_DEEP_LINK_SCHEME: z.string().default("eventscout://"),
  WEB_DEEP_LINK_BASE: z.string().url().default("https://eventscout.netlify.app"),
  AI_PROVIDER: z.enum(["openai", "gemini"]).default("gemini"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  EVENTBRITE_API_TOKEN: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  X_API_BEARER_TOKEN: z.string().optional(),
  HASHNODE_PUBLICATION_HOSTS: z.string().optional(),
  RSS_SOURCE_FEEDS: z.string().optional(),
  INGESTION_CRON_EXPRESSION: z.string().default("0 0 * * *"),
  INGESTION_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  INGESTION_USE_AI_VALIDATION: z.coerce.boolean().default(true),
  INGESTION_VALIDATION_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.6),
  SCRAPE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  SCRAPE_MAX_LINKS_PER_SOURCE: z.coerce.number().int().min(1).max(15).default(4),
  SCRAPE_MAX_SOURCES_PER_RUN: z.coerce.number().int().min(1).max(100).default(20),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default("eventscout/events"),
  EVENT_PLACEHOLDER_IMAGE_URL: z
    .string()
    .url()
    .default(
      "https://images.unsplash.com/photo-1591453089343-3fbf5cce2c70?auto=format&fit=crop&w=1200&q=80",
    ),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default("*"),
});

const parsed = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET ??
    "development-access-secret-change-me-please",
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET ??
    "development-refresh-secret-change-me-please",
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS,
  OTP_EXPIRY_MINUTES: process.env.OTP_EXPIRY_MINUTES,
  CLIENT_DEEP_LINK_SCHEME: process.env.CLIENT_DEEP_LINK_SCHEME,
  WEB_DEEP_LINK_BASE: process.env.WEB_DEEP_LINK_BASE,
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  EVENTBRITE_API_TOKEN: process.env.EVENTBRITE_API_TOKEN,
  SERPAPI_API_KEY: process.env.SERPAPI_API_KEY,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  X_API_BEARER_TOKEN: process.env.X_API_BEARER_TOKEN,
  HASHNODE_PUBLICATION_HOSTS: process.env.HASHNODE_PUBLICATION_HOSTS,
  RSS_SOURCE_FEEDS: process.env.RSS_SOURCE_FEEDS,
  INGESTION_CRON_EXPRESSION: process.env.INGESTION_CRON_EXPRESSION,
  INGESTION_INTERVAL_MINUTES: process.env.INGESTION_INTERVAL_MINUTES,
  INGESTION_USE_AI_VALIDATION: process.env.INGESTION_USE_AI_VALIDATION,
  INGESTION_VALIDATION_MIN_SCORE: process.env.INGESTION_VALIDATION_MIN_SCORE,
  SCRAPE_REQUEST_TIMEOUT_MS: process.env.SCRAPE_REQUEST_TIMEOUT_MS,
  SCRAPE_MAX_LINKS_PER_SOURCE: process.env.SCRAPE_MAX_LINKS_PER_SOURCE,
  SCRAPE_MAX_SOURCES_PER_RUN: process.env.SCRAPE_MAX_SOURCES_PER_RUN,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER,
  EVENT_PLACEHOLDER_IMAGE_URL: process.env.EVENT_PLACEHOLDER_IMAGE_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
});

if (!parsed.success) {
  const reasons = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid backend environment configuration:\n${reasons}`);
}

const value = parsed.data;

export const env = {
  ...value,
  accessTokenTtlSeconds: parseDurationToSeconds(value.ACCESS_TOKEN_TTL),
};

export type AppEnv = typeof env;
