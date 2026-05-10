import { AttendanceStatus, EventCategory, EventSourceType, ThemeMode } from "@prisma/client";

const categoryMap: Record<string, EventCategory> = {
  ai: "AI",
  cloud: "CLOUD",
  security: "SECURITY",
  frontend: "FRONTEND",
  mobile: "MOBILE",
  data: "DATA",
  devops: "DEVOPS",
  community: "COMMUNITY",
};

const sourceTypeMap: Record<string, EventSourceType> = {
  "social-media": "SOCIAL_MEDIA",
  website: "WEBSITE",
  newsletter: "NEWSLETTER",
  community: "COMMUNITY",
};

export const parseEventCategory = (value: string): EventCategory | null => {
  const normalized = value.trim().toLowerCase();
  return categoryMap[normalized] ?? null;
};

export const parseSourceType = (value: string): EventSourceType | null => {
  const normalized = value.trim().toLowerCase();
  return sourceTypeMap[normalized] ?? null;
};

export const parseAttendanceStatus = (
  value: string,
): AttendanceStatus | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "going") {
    return "GOING";
  }
  if (normalized === "not-going") {
    return "NOT_GOING";
  }
  return null;
};

export const parseThemeMode = (value: string): ThemeMode | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "light") {
    return "LIGHT";
  }
  if (normalized === "dark") {
    return "DARK";
  }
  return null;
};
