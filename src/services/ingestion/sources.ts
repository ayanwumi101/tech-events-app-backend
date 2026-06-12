import { EventSourceType } from "@prisma/client";

export interface DefaultAiSource {
  name: string;
  type: EventSourceType;
  url: string;
}

// Curated list of reliable tech-event sources used to seed the AiSource table
// on first run. All URLs must point to actual event listing pages, not blogs or feeds.
export const defaultAiSources: DefaultAiSource[] = [
  {
    name: "Eventbrite Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/online/technology--events/",
  },
  {
    name: "Luma Discover",
    type: "COMMUNITY",
    url: "https://lu.ma/discover",
  },
  {
    name: "Devpost Hackathons",
    type: "WEBSITE",
    url: "https://devpost.com/hackathons",
  },
  {
    name: "Google Developers Events",
    type: "WEBSITE",
    url: "https://developers.google.com/events",
  },
  {
    name: "Google Cloud Events",
    type: "WEBSITE",
    url: "https://cloud.google.com/events",
  },
  {
    name: "Microsoft Reactor Events",
    type: "WEBSITE",
    url: "https://developer.microsoft.com/en-us/reactor/events/",
  },
  {
    name: "CNCF Events",
    type: "WEBSITE",
    url: "https://www.cncf.io/events/",
  },
  {
    name: "AWS Events and Webinars",
    type: "WEBSITE",
    url: "https://aws.amazon.com/events/",
  },
  {
    name: "InfoQ Events",
    type: "WEBSITE",
    url: "https://www.infoq.com/events/",
  },
  {
    name: "Sessionize Upcoming Conferences",
    type: "WEBSITE",
    url: "https://sessionize.com/app/speaker/sessions/upcoming",
  },
  {
    name: "Dev Events",
    type: "WEBSITE",
    url: "https://dev.events/",
  },
  {
    name: "Papercall Open CFPs",
    type: "WEBSITE",
    url: "https://www.papercall.io/cfps",
  },
  {
    name: "MLOps Community Events",
    type: "COMMUNITY",
    url: "https://mlops.community/events/",
  },
  {
    name: "GDG Community Events",
    type: "COMMUNITY",
    url: "https://gdg.community.dev/events/",
  },
  {
    name: "Meetup Technology Events",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=technology",
  },
];
