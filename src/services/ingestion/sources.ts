import { EventSourceType } from "@prisma/client";

export interface DefaultAiSource {
  name: string;
  type: EventSourceType;
  url: string;
}

// Curated list of sources with strong African tech event coverage.
// All URLs point to event listing pages, not blogs.
export const defaultAiSources: DefaultAiSource[] = [
  // Eventbrite regional pages for the most active African tech markets
  {
    name: "Eventbrite Nigeria Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/nigeria/technology--events/",
  },
  {
    name: "Eventbrite Kenya Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/kenya/technology--events/",
  },
  {
    name: "Eventbrite South Africa Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/south-africa/technology--events/",
  },
  {
    name: "Eventbrite Ghana Tech Events",
    type: "WEBSITE",
    url: "https://www.eventbrite.com/d/ghana/technology--events/",
  },
  // Luma has a large and growing community of African tech events
  {
    name: "Luma Discover",
    type: "COMMUNITY",
    url: "https://lu.ma/discover",
  },
  // Devpost hosts many Africa-accessible online hackathons
  {
    name: "Devpost Hackathons",
    type: "WEBSITE",
    url: "https://devpost.com/hackathons",
  },
  // Google Developer Groups are very active across Africa
  {
    name: "GDG Community Events",
    type: "COMMUNITY",
    url: "https://gdg.community.dev/events/",
  },
  // Microsoft Reactor Lagos and Nairobi host regular events
  {
    name: "Microsoft Reactor Events",
    type: "WEBSITE",
    url: "https://developer.microsoft.com/en-us/reactor/events/",
  },
  // Zindi hosts African-focused AI/ML competitions and events
  {
    name: "Zindi Africa Events",
    type: "COMMUNITY",
    url: "https://zindi.africa/competitions",
  },
  // Meetup for major African tech cities
  {
    name: "Meetup Lagos Tech",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=tech&location=Lagos%2C+Nigeria",
  },
  {
    name: "Meetup Nairobi Tech",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=tech&location=Nairobi%2C+Kenya",
  },
  {
    name: "Meetup Cape Town Tech",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=tech&location=Cape+Town%2C+South+Africa",
  },
  {
    name: "Meetup Accra Tech",
    type: "COMMUNITY",
    url: "https://www.meetup.com/find/?keywords=tech&location=Accra%2C+Ghana",
  },
];
