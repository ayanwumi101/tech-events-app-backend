const DURATION_REGEX = /^(\d+)([smhd])$/i;

const UNIT_TO_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
};

export const parseDurationToSeconds = (value: string): number => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(DURATION_REGEX);

  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use formats like 30s, 15m, 2h, 7d.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  return amount * UNIT_TO_SECONDS[unit];
};

export const addSeconds = (date: Date, seconds: number): Date => {
  return new Date(date.getTime() + seconds * 1000);
};

export const addDays = (date: Date, days: number): Date => {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
};
