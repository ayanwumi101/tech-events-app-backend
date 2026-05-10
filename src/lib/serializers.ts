import {
  AttendanceStatus,
  Event,
  EventCategory,
  EventSourceType,
  Notification,
  ThemeMode,
  User,
} from "@prisma/client";

type NullableAttendance = { status: AttendanceStatus } | null;

const toThemeMode = (value: ThemeMode): "light" | "dark" => {
  return value === "LIGHT" ? "light" : "dark";
};

const toAttendanceStatus = (
  value: AttendanceStatus,
): "going" | "not-going" => {
  return value === "GOING" ? "going" : "not-going";
};

const toSourceType = (
  value: EventSourceType,
): "social-media" | "website" | "newsletter" | "community" => {
  if (value === "SOCIAL_MEDIA") {
    return "social-media";
  }
  if (value === "WEBSITE") {
    return "website";
  }
  if (value === "NEWSLETTER") {
    return "newsletter";
  }
  return "community";
};

const toCategory = (value: EventCategory): string => {
  switch (value) {
    case "AI":
      return "AI";
    case "CLOUD":
      return "Cloud";
    case "SECURITY":
      return "Security";
    case "FRONTEND":
      return "Frontend";
    case "MOBILE":
      return "Mobile";
    case "DATA":
      return "Data";
    case "DEVOPS":
      return "DevOps";
    case "COMMUNITY":
    default:
      return "Community";
  }
};

export const serializeUser = (user: User) => {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    country: user.country,
    role: user.role,
    emailVerified: user.emailVerified,
    hasCompletedOnboarding: user.onboardingCompleted,
    themeMode: toThemeMode(user.themeMode),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
};

export const serializeEvent = (
  event: Event,
  options?: {
    isFavorite?: boolean;
    attendance?: NullableAttendance;
  },
) => {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    description: event.description,
    category: toCategory(event.category),
    sourceType: toSourceType(event.sourceType),
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    registrationUrl: event.registrationUrl,
    location: event.location,
    venue: event.venue,
    city: event.city,
    country: event.country,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    imageUrl: event.imageUrl,
    tags: event.tags,
    priceLabel: event.priceLabel,
    attendeeEstimate: event.attendeeEstimate,
    aiConfidence: event.aiConfidence,
    aiSummary: event.aiSummary,
    ingestedAt: event.ingestedAt.toISOString(),
    isFavorite: options?.isFavorite ?? false,
    attendanceStatus: options?.attendance
      ? toAttendanceStatus(options.attendance.status)
      : null,
  };
};

export const serializeNotification = (notification: Notification) => {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    eventId: notification.eventId,
    read: Boolean(notification.readAt),
    createdAt: notification.createdAt.toISOString(),
  };
};

export const serializeAttendanceStatus = toAttendanceStatus;
