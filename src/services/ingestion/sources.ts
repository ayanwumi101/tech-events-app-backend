import { EventSourceType } from "@prisma/client";

import { SourceSnippet } from "../../types/event.js";

export interface DefaultAiSource {
  name: string;
  type: EventSourceType;
  url: string;
}

const now = new Date();

const isoInDays = (days: number, hours: number, minutes: number): string => {
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  next.setHours(hours, minutes, 0, 0);
  return next.toISOString();
};

export const defaultAiSources: DefaultAiSource[] = [
  {
    name: "Eventbrite Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/online/technology--events/",
  },
  {
    name: "Meetup Technology Events",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=technology",
  },
  {
    name: "Luma Discover",
    type: "COMMUNITY",
    url: "https://lu.ma/discover",
  },
  {
    name: "Google Developers Events",
    type: "WEBSITE",
    url: "https://developers.google.com/events",
  },
  {
    name: "Google Developers Blog RSS",
    type: "NEWSLETTER",
    url: "https://blog.google/rss/",
  },
  {
    name: "GitHub Engineering Blog RSS",
    type: "NEWSLETTER",
    url: "https://github.blog/feed/",
  },
  {
    name: "Dev.to Events Tag",
    type: "NEWSLETTER",
    url: "https://dev.to/t/events",
  },
  {
    name: "Hashnode Engineering",
    type: "NEWSLETTER",
    url: "https://engineering.hashnode.com/",
  },
  {
    name: "Google Developers Blog",
    type: "WEBSITE",
    url: "https://developers.googleblog.com/",
  },
  {
    name: "CNCF Events",
    type: "WEBSITE",
    url: "https://www.cncf.io/events/",
  },
  {
    name: "Microsoft Reactor",
    type: "WEBSITE",
    url: "https://developer.microsoft.com/en-us/reactor/events/",
  },
  {
    name: "Devpost Hackathons",
    type: "WEBSITE",
    url: "https://devpost.com/hackathons",
  },
  {
    name: "LinkedIn Events",
    type: "SOCIAL_MEDIA",
    url: "https://www.linkedin.com/events/",
  },
  {
    name: "X Tech Meetup Search",
    type: "SOCIAL_MEDIA",
    url: "https://x.com/search?q=tech%20meetup&f=live",
  },
];

export const fallbackSourceSnippets: SourceSnippet[] = [
  {
    sourceName: "Lagos AI Community",
    sourceType: "COMMUNITY",
    sourceUrl:
      "https://www.meetup.com/lagos-artificial-intelligence-and-deep-learning",
    registrationUrl:
      "https://www.meetup.com/lagos-artificial-intelligence-and-deep-learning",
    imageUrl:
      "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80",
    rawText: `Event: Lagos AI Builders Meetup
Date: ${isoInDays(4, 17, 30)}
End: ${isoInDays(4, 20, 0)}
City: Lagos
Country: Nigeria
Venue: Landmark Event Centre
Price: Free
Summary: Hands-on demos from founders shipping AI products in Africa.`,
  },
  {
    sourceName: "Cloud Native Africa",
    sourceType: "WEBSITE",
    sourceUrl: "https://cloudnativeafrica.com",
    registrationUrl: "https://cloudnativeafrica.com",
    imageUrl:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80",
    rawText: `Event: Cloud Native Africa Summit 2026
Date: ${isoInDays(10, 9, 0)}
End: ${isoInDays(11, 17, 0)}
City: Nairobi
Country: Kenya
Venue: KICC
Price: $40
Summary: Kubernetes, platform engineering, and cloud cost optimization.`,
  },
  {
    sourceName: "Frontend Weekly",
    sourceType: "NEWSLETTER",
    sourceUrl: "https://frontendfoc.us",
    registrationUrl: "https://frontendfoc.us",
    imageUrl:
      "https://images.unsplash.com/photo-1551818255-e6e10975bc17?auto=format&fit=crop&w=1200&q=80",
    rawText: `Event: Frontend Futures Live
Date: ${isoInDays(7, 16, 0)}
End: ${isoInDays(7, 19, 30)}
City: Remote
Country: Global
Venue: Online Livestream
Price: $15
Summary: State of React Native, AI interfaces, and design systems.`,
  },
];
