export interface EventCandidate {
  id: string;
  title: string;
  summary: string;
  description: string;
  category:
    | "AI"
    | "CLOUD"
    | "SECURITY"
    | "FRONTEND"
    | "MOBILE"
    | "DATA"
    | "DEVOPS"
    | "COMMUNITY";
  sourceType: "SOCIAL_MEDIA" | "WEBSITE" | "NEWSLETTER" | "COMMUNITY";
  sourceName: string;
  sourceUrl: string;
  registrationUrl: string;
  location: string;
  venue: string;
  city: string;
  country: string;
  startDate: string;
  endDate: string;
  imageUrl: string;
  tags: string[];
  priceLabel: string;
  attendeeEstimate: number;
  aiConfidence: number;
  aiSummary: string;
}

export interface SourceSnippet {
  sourceName: string;
  sourceType: "SOCIAL_MEDIA" | "WEBSITE" | "NEWSLETTER" | "COMMUNITY";
  sourceUrl: string;
  registrationUrl: string;
  rawText: string;
  imageUrl: string;
}
