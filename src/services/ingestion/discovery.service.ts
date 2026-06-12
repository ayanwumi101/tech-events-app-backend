import { EventSourceType } from "@prisma/client";

import { env } from "../../config/env.js";
import { SourceSnippet } from "../../types/event.js";
import { scrapeSourcesForSnippets } from "./scraper.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  sourceType: EventSourceType;
}

interface ScrapeSourceConfig {
  name: string;
  type: EventSourceType;
  url: string;
}

// Hashnode publication hosts are opt-in via HASHNODE_PUBLICATION_HOSTS env var.
// Do not default to tech blogs — only query hosts that publish event listings.
const DEFAULT_HASHNODE_HOSTS: string[] = [];

// RSS feeds must point to event-listing feeds, not general tech blogs.
// Provide a curated list only when users explicitly configure RSS_SOURCE_FEEDS.
const DEFAULT_RSS_FEEDS: string[] = [];

const LUMA_SEED_URLS = [
  "https://lu.ma/discover",
  "https://lu.ma/calendar",
];

const TECH_TERMS = [
  "tech",
  "developer",
  "engineering",
  "software",
  "ai",
  "cloud",
  "frontend",
  "backend",
  "devops",
  "data",
  "security",
  "startup",
  "open source",
];

const EVENT_TERMS = [
  "event",
  "meetup",
  "conference",
  "summit",
  "workshop",
  "hackathon",
  "webinar",
  "mentorship",
  "bootcamp",
  "masterclass",
];

// All queries are scoped to Africa so search engine results are geographically relevant.
const SEARCH_QUERIES = [
  "tech (meetup OR conference OR hackathon OR workshop) (Africa OR Nigeria OR Kenya OR Ghana OR \"South Africa\" OR Rwanda OR Uganda OR Senegal OR Ethiopia OR Tanzania)",
  "site:lu.ma (tech OR developer) (Lagos OR Nairobi OR Accra OR \"Cape Town\" OR Kigali OR Abuja OR Kampala OR \"Addis Ababa\" OR Dakar)",
  "developer (conference OR summit OR bootcamp) (Lagos OR Nairobi OR Accra OR Johannesburg OR Kigali OR Abuja) 2025 OR 2026",
  "(hackathon OR workshop) Africa (tech OR AI OR software OR developer) 2025 OR 2026",
  "site:linkedin.com/events (tech OR developer OR software) (Africa OR Nigeria OR Kenya OR Ghana OR \"South Africa\")",
  "site:facebook.com/events (tech OR hackathon OR conference) (Africa OR Lagos OR Nairobi OR Accra OR \"Cape Town\")",
];

// African ISO 3166-1 alpha-2 country codes used to filter API responses.
const AFRICAN_ISO_CODES = new Set([
  "NG", "KE", "ZA", "GH", "ET", "TZ", "UG", "RW", "SN", "EG", "MA", "TN",
  "DZ", "AO", "MZ", "ZM", "ZW", "CM", "CI", "CD", "MG", "MW", "BW", "NA",
  "ML", "BF", "NE", "TD", "SD", "SS", "ER", "DJ", "SO", "LR", "SL", "GN",
  "GW", "GM", "CV", "TG", "BJ", "GA", "GQ", "CF", "ST", "KM", "MU", "SC",
  "LS", "SZ", "BI", "LY", "MR",
]);

const safeUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const startsWithAny = (text: string, terms: string[]): boolean => {
  return terms.some((term) => text.includes(term));
};

const looksLikeTechEvent = (value: string): boolean => {
  const text = value.toLowerCase();
  return startsWithAny(text, TECH_TERMS) && startsWithAny(text, EVENT_TERMS);
};

const withTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.SCRAPE_REQUEST_TIMEOUT_MS,
  );

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJson = async <T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> => {
  try {
    const response = await withTimeout((signal) =>
      fetch(url, {
        ...init,
        signal,
      }),
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const fetchText = async (url: string, init?: RequestInit): Promise<string | null> => {
  try {
    const response = await withTimeout((signal) =>
      fetch(url, {
        ...init,
        signal,
      }),
    );
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
};

const joinSnippetLines = (lines: string[]): string => {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeWhitespace(line))
    .join("\n");
};

const dedupeSnippets = (snippets: SourceSnippet[]): SourceSnippet[] => {
  const seen = new Set<string>();
  const deduped: SourceSnippet[] = [];

  for (const snippet of snippets) {
    const key = `${snippet.registrationUrl}:${snippet.rawText.slice(0, 180)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(snippet);
  }

  return deduped;
};

const buildSnippet = (input: {
  title: string;
  summary: string;
  sourceName: string;
  sourceType: EventSourceType;
  sourceUrl: string;
  registrationUrl: string;
  startDate?: string;
  endDate?: string;
  city?: string;
  country?: string;
  venue?: string;
  price?: string;
  imageUrl?: string;
}): SourceSnippet | null => {
  const sourceUrl = safeUrl(input.sourceUrl);
  const registrationUrl = safeUrl(input.registrationUrl ?? input.sourceUrl);

  if (!sourceUrl || !registrationUrl) {
    return null;
  }

  const title = normalizeWhitespace(input.title);
  const summary = normalizeWhitespace(input.summary);
  if (!title || !looksLikeTechEvent(`${title} ${summary}`)) {
    return null;
  }

  return {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    sourceUrl,
    registrationUrl,
    imageUrl: safeUrl(input.imageUrl) ?? "",
    rawText: joinSnippetLines([
      `Event: ${title}`,
      input.startDate ? `Date: ${input.startDate}` : "",
      input.endDate ? `End: ${input.endDate}` : "",
      input.city ? `City: ${input.city}` : "",
      input.country ? `Country: ${input.country}` : "",
      input.venue ? `Venue: ${input.venue}` : "",
      input.price ? `Price: ${input.price}` : "",
      summary ? `Summary: ${summary}` : "",
    ]),
  };
};

const collectEventbriteSnippets = async (): Promise<SourceSnippet[]> => {
  if (!env.EVENTBRITE_API_TOKEN) {
    return [];
  }

  interface EventbriteSearchResponse {
    events?: Array<{
      name?: { text?: string | null };
      description?: { text?: string | null };
      url?: string | null;
      start?: { utc?: string | null };
      end?: { utc?: string | null };
      logo?: { url?: string | null };
      venue?: {
        name?: string | null;
        address?: {
          city?: string | null;
          country?: string | null;
        };
      };
    }>;
  }

  // Restrict to the African continent via Eventbrite's location.address field.
  // Individual country pages in defaultAiSources supplement this broad query.
  const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
  url.searchParams.set("q", "tech meetup workshop conference hackathon");
  url.searchParams.set("expand", "venue");
  url.searchParams.set("sort_by", "date");
  url.searchParams.set("location.address", "Africa");
  url.searchParams.set("location.within", "50000km");

  const data = await fetchJson<EventbriteSearchResponse>(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.EVENTBRITE_API_TOKEN}`,
    },
  });
  if (!data?.events?.length) {
    return [];
  }

  return dedupeSnippets(
    data.events
      .map((item) =>
        buildSnippet({
          title: item.name?.text ?? "",
          summary: item.description?.text ?? "",
          sourceName: "Eventbrite API",
          sourceType: "WEBSITE",
          sourceUrl: item.url ?? "",
          registrationUrl: item.url ?? "",
          startDate: item.start?.utc ?? undefined,
          endDate: item.end?.utc ?? undefined,
          city: item.venue?.address?.city ?? undefined,
          country: item.venue?.address?.country ?? undefined,
          venue: item.venue?.name ?? undefined,
          imageUrl: item.logo?.url ?? undefined,
        }),
      )
      .filter((item): item is SourceSnippet => item !== null),
  );
};

const collectHashnodeSnippets = async (): Promise<SourceSnippet[]> => {
  interface HashnodeQueryResponse {
    data?: {
      publication?: {
        title?: string;
        posts?: {
          edges?: Array<{
            node?: {
              title?: string;
              brief?: string;
              url?: string;
              publishedAt?: string;
            };
          }>;
        };
      } | null;
    };
  }

  const hosts = (env.HASHNODE_PUBLICATION_HOSTS
    ? env.HASHNODE_PUBLICATION_HOSTS.split(",")
    : DEFAULT_HASHNODE_HOSTS
  )
    .map((value) => value.trim())
    .filter(Boolean);

  if (!hosts.length) {
    return [];
  }

  const query = `
    query PublicationPosts($host: String!, $first: Int!) {
      publication(host: $host) {
        title
        posts(first: $first) {
          edges {
            node {
              title
              brief
              url
              publishedAt
            }
          }
        }
      }
    }
  `;

  const results = await Promise.all(
    hosts.map(async (host) => {
      const data = await fetchJson<HashnodeQueryResponse>(
        "https://gql.hashnode.com",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables: {
              host,
              first: 20,
            },
          }),
        },
      );

      if (!data?.data?.publication?.posts?.edges?.length) {
        return [];
      }

      const publicationName =
        data.data.publication.title?.trim() || `Hashnode • ${host}`;

      return data.data.publication.posts.edges
        .map((edge) => edge.node)
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .map((node) =>
          buildSnippet({
            title: node.title ?? "",
            summary: node.brief ?? "",
            sourceName: publicationName,
            sourceType: "NEWSLETTER",
            sourceUrl: node.url ?? "",
            registrationUrl: node.url ?? "",
            startDate: node.publishedAt ?? undefined,
          }),
        )
        .filter((item): item is SourceSnippet => item !== null);
    }),
  );

  return dedupeSnippets(results.flat());
};

const extractXmlTag = (value: string, tag: string): string => {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = value.match(regex);
  if (!match?.[1]) {
    return "";
  }

  return normalizeWhitespace(
    match[1]
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .replace(/<[^>]+>/g, " "),
  );
};

const collectRssSnippets = async (): Promise<SourceSnippet[]> => {
  const feeds = (env.RSS_SOURCE_FEEDS
    ? env.RSS_SOURCE_FEEDS.split(",")
    : DEFAULT_RSS_FEEDS
  )
    .map((value) => value.trim())
    .filter(Boolean);

  if (!feeds.length) {
    return [];
  }

  const results = await Promise.all(
    feeds.map(async (feedUrl) => {
      const text = await fetchText(feedUrl);
      if (!text) {
        return [];
      }

      const items = [...text.matchAll(/<item[\s\S]*?<\/item>/gi)]
        .map((match) => match[0])
        .slice(0, 20);

      return items
        .map((item) => {
          const title = extractXmlTag(item, "title");
          const summary =
            extractXmlTag(item, "description") || extractXmlTag(item, "content:encoded");
          const link = extractXmlTag(item, "link");
          const pubDate = extractXmlTag(item, "pubDate");
          return buildSnippet({
            title,
            summary,
            sourceName: `RSS • ${new URL(feedUrl).hostname}`,
            sourceType: "NEWSLETTER",
            sourceUrl: link,
            registrationUrl: link,
            startDate: pubDate || undefined,
          });
        })
        .filter((snippet): snippet is SourceSnippet => snippet !== null);
    }),
  );

  return dedupeSnippets(results.flat());
};

const parseHostToSourceType = (url: string): EventSourceType => {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("x.com") || host.includes("twitter.com")) {
    return "SOCIAL_MEDIA";
  }
  if (
    host.includes("meetup.com") ||
    host.includes("lu.ma") ||
    host.includes("eventbrite.")
  ) {
    return "COMMUNITY";
  }
  if (host.includes("linkedin.com")) {
    return "SOCIAL_MEDIA";
  }
  return "WEBSITE";
};

const collectSerpApiResults = async (): Promise<SearchResult[]> => {
  if (!env.SERPAPI_API_KEY) {
    return [];
  }

  interface SerpApiResponse {
    organic_results?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      source?: string;
    }>;
  }

  const responses = await Promise.all(
    SEARCH_QUERIES.map(async (query) => {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("num", "20");
      url.searchParams.set("api_key", env.SERPAPI_API_KEY!);
      return fetchJson<SerpApiResponse>(url.toString());
    }),
  );

  const results = responses.flatMap((payload) => payload?.organic_results ?? []);
  return results
    .map((item) => {
      const url = safeUrl(item.link);
      if (!url) {
        return null;
      }
      return {
        title: item.title ?? "",
        url,
        snippet: item.snippet ?? "",
        sourceName: item.source ?? "SerpAPI Discovery",
        sourceType: parseHostToSourceType(url),
      } satisfies SearchResult;
    })
    .filter((item): item is SearchResult => item !== null);
};

const collectBraveResults = async (): Promise<SearchResult[]> => {
  if (!env.BRAVE_SEARCH_API_KEY) {
    return [];
  }

  interface BraveResponse {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  }

  const responses = await Promise.all(
    SEARCH_QUERIES.map(async (query) => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", "20");
      return fetchJson<BraveResponse>(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY!,
        },
      });
    }),
  );

  const results = responses.flatMap((payload) => payload?.web?.results ?? []);
  return results
    .map((item) => {
      const url = safeUrl(item.url);
      if (!url) {
        return null;
      }
      return {
        title: item.title ?? "",
        url,
        snippet: item.description ?? "",
        sourceName: "Brave Search Discovery",
        sourceType: parseHostToSourceType(url),
      } satisfies SearchResult;
    })
    .filter((item): item is SearchResult => item !== null);
};

// Domains that host real event registration pages.
// Used to pick the best registrationUrl out of a tweet's entity URLs.
const EVENT_PLATFORM_DOMAINS = [
  "eventbrite.com",
  "lu.ma",
  "devpost.com",
  "meetup.com",
  "hopin.com",
  "sessionize.com",
  "papercall.io",
  "gdg.community.dev",
  "dev.events",
];

const collectXSnippets = async (): Promise<SourceSnippet[]> => {
  if (!env.X_API_BEARER_TOKEN) {
    return [];
  }

  interface XTweet {
    id: string;
    text: string;
    created_at?: string;
    entities?: {
      urls?: Array<{
        url: string;
        expanded_url?: string;
      }>;
    };
  }

  interface XSearchResponse {
    data?: XTweet[];
  }

  // Focused on Africa-specific event hashtags and geographic keywords.
  const query =
    '("tech event" OR "tech conference" OR "developer meetup" OR hackathon OR "call for speakers" OR #AfricaTech OR #techAfrica OR #AfricaHacks OR #devmeetupAfrica OR #hackathon) (Africa OR Nigeria OR Kenya OR Ghana OR "South Africa" OR Rwanda OR Uganda OR Senegal OR Ethiopia) -is:retweet lang:en';
  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "30");
  url.searchParams.set("tweet.fields", "created_at,entities");

  const data = await fetchJson<XSearchResponse>(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.X_API_BEARER_TOKEN}`,
    },
  });
  if (!data?.data?.length) {
    return [];
  }

  return dedupeSnippets(
    data.data
      .map((tweet) => {
        const tweetUrl = `https://x.com/i/web/status/${tweet.id}`;
        // Prefer a URL that points to an actual event registration page.
        const eventUrl =
          tweet.entities?.urls
            ?.map((u) => u.expanded_url ?? "")
            .find((u) =>
              EVENT_PLATFORM_DOMAINS.some((domain) => u.includes(domain)),
            ) ?? tweetUrl;

        return buildSnippet({
          title:
            tweet.text.slice(0, 120).replace(/\n/g, " ").trim() ||
            "X Tech Event",
          summary: tweet.text,
          sourceName: "X (Twitter)",
          sourceType: "SOCIAL_MEDIA",
          sourceUrl: tweetUrl,
          registrationUrl: eventUrl,
          startDate: tweet.created_at ?? undefined,
        });
      })
      .filter((item): item is SourceSnippet => item !== null),
  );
};

// Reddit's public JSON API lets us search tech subreddits for event posts
// without any authentication. Multi-subreddit syntax keeps the request count low.
const collectRedditSnippets = async (): Promise<SourceSnippet[]> => {
  interface RedditChild {
    data: {
      title: string;
      selftext: string;
      url: string;
      permalink: string;
      created_utc: number;
      is_self: boolean;
      subreddit: string;
    };
  }

  interface RedditResponse {
    data?: {
      children?: RedditChild[];
    };
  }

  const subreddits =
    "africa+Nigeria+Kenya+southafrica+ghana+Ethiopia+Rwanda+Uganda+technology";
  const query =
    "conference OR hackathon OR workshop OR meetup OR \"tech event\" OR CFP Africa";

  const url = new URL(
    `https://www.reddit.com/r/${subreddits}/search.json`,
  );
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "new");
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("limit", "50");
  url.searchParams.set("t", "month");

  const data = await fetchJson<RedditResponse>(url.toString(), {
    headers: {
      "User-Agent":
        "EventScoutBot/1.0 (+https://eventscout.app; tech event discovery)",
    },
  });

  if (!data?.data?.children?.length) {
    return [];
  }

  return dedupeSnippets(
    data.data.children
      .map((child) => {
        const post = child.data;
        const postUrl = `https://reddit.com${post.permalink}`;
        // For link posts the url field holds the external link;
        // for self-posts it loops back to the Reddit thread.
        const registrationUrl =
          !post.is_self && post.url && post.url !== postUrl
            ? post.url
            : postUrl;

        return buildSnippet({
          title: post.title,
          summary: post.selftext.slice(0, 500),
          sourceName: `Reddit • r/${post.subreddit}`,
          sourceType: "SOCIAL_MEDIA",
          sourceUrl: postUrl,
          registrationUrl,
          startDate: new Date(post.created_utc * 1000).toISOString(),
        });
      })
      .filter((item): item is SourceSnippet => item !== null),
  );
};

// Bluesky has a public search endpoint that requires no authentication.
// Many developers have moved here from Twitter and actively post about events.
const collectBlueskySnippets = async (): Promise<SourceSnippet[]> => {
  interface BlueskyPost {
    uri: string;
    record: {
      text: string;
      createdAt: string;
      langs?: string[];
    };
    author: {
      handle: string;
      displayName?: string;
    };
  }

  interface BlueskyResponse {
    posts?: BlueskyPost[];
  }

  const queries = [
    "tech conference hackathon Africa 2025 OR 2026",
    "developer meetup Lagos OR Nairobi OR Accra OR \"Cape Town\" OR Kigali OR Abuja OR Kampala",
    "CFP \"call for proposals\" Africa tech",
  ];

  const results = await Promise.all(
    queries.map((q) => {
      const url = new URL(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts",
      );
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "20");
      url.searchParams.set("sort", "latest");
      url.searchParams.set("lang", "en");
      return fetchJson<BlueskyResponse>(url.toString());
    }),
  );

  const posts = results.flatMap((r) => r?.posts ?? []);
  if (!posts.length) {
    return [];
  }

  return dedupeSnippets(
    posts
      .map((post) => {
        const handle = post.author.handle;
        const postId = post.uri.split("/").pop() ?? "";
        const postUrl = `https://bsky.app/profile/${handle}/post/${postId}`;

        return buildSnippet({
          title:
            post.record.text.slice(0, 120).replace(/\n/g, " ").trim() ||
            "Bluesky Tech Event Post",
          summary: post.record.text,
          sourceName: `Bluesky • ${post.author.displayName ?? post.author.handle}`,
          sourceType: "SOCIAL_MEDIA",
          sourceUrl: postUrl,
          registrationUrl: postUrl,
          startDate: post.record.createdAt,
        });
      })
      .filter((item): item is SourceSnippet => item !== null),
  );
};

const mapSearchResultsToSnippets = (results: SearchResult[]): SourceSnippet[] => {
  return dedupeSnippets(
    results
      .map((item) =>
        buildSnippet({
          title: item.title,
          summary: item.snippet,
          sourceName: item.sourceName,
          sourceType: item.sourceType,
          sourceUrl: item.url,
          registrationUrl: item.url,
        }),
      )
      .filter((item): item is SourceSnippet => item !== null),
  );
};

const mapSearchResultsToScrapeSources = (results: SearchResult[]): ScrapeSourceConfig[] => {
  const seeded = new Set<string>();
  const sources: ScrapeSourceConfig[] = [];

  const pushSource = (source: ScrapeSourceConfig) => {
    if (seeded.has(source.url)) {
      return;
    }
    seeded.add(source.url);
    sources.push(source);
  };

  for (const result of results) {
    const sourceUrl = safeUrl(result.url);
    if (!sourceUrl) {
      continue;
    }

    // Attempt to scrape individual LinkedIn and Facebook event pages discovered
    // via search. Many public event pages return structured JSON-LD data even
    // without login, which the scraper can extract.
    if (
      sourceUrl.includes("lu.ma") ||
      sourceUrl.includes("linkedin.com/events/") ||
      sourceUrl.includes("facebook.com/events/")
    ) {
      pushSource({
        name: result.sourceName,
        type: result.sourceType,
        url: sourceUrl,
      });
    }
  }

  for (const seedUrl of LUMA_SEED_URLS) {
    const url = safeUrl(seedUrl);
    if (!url) {
      continue;
    }
    pushSource({
      name: "Luma Discovery",
      type: "COMMUNITY",
      url,
    });
  }

  return sources.slice(0, 25);
};

// Fetch real upcoming tech conferences from the community-maintained
// conference-data repository on GitHub (backing confs.tech).
const collectConfsTechEvents = async (): Promise<SourceSnippet[]> => {
  interface ConfsItem {
    name?: string;
    url?: string;
    startDate?: string;
    endDate?: string;
    city?: string;
    country?: string;
    cfpUrl?: string;
    cfpEndDate?: string;
  }

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

  const results = await Promise.all(
    years.map((year) =>
      fetchJson<ConfsItem[]>(
        `https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/${year}.json`,
      ),
    ),
  );

  const now = new Date();
  const items = results.flatMap((batch) => (Array.isArray(batch) ? batch : []));

  // Normalise country names to lowercase for comparison against AFRICAN_ISO_CODES
  // and common country name strings present in the confs.tech data.
  const AFRICA_COUNTRY_NAMES = new Set([
    "nigeria", "kenya", "south africa", "ghana", "ethiopia", "tanzania",
    "uganda", "rwanda", "senegal", "egypt", "morocco", "tunisia", "algeria",
    "angola", "mozambique", "zambia", "zimbabwe", "cameroon", "ivory coast",
    "côte d'ivoire", "cote d'ivoire", "democratic republic of congo", "congo",
    "drc", "madagascar", "malawi", "botswana", "namibia", "mali",
    "burkina faso", "niger", "chad", "sudan", "south sudan", "eritrea",
    "djibouti", "somalia", "liberia", "sierra leone", "guinea", "guinea-bissau",
    "gambia", "cape verde", "cabo verde", "togo", "benin", "gabon",
    "equatorial guinea", "central african republic", "sao tome", "comoros",
    "mauritius", "seychelles", "lesotho", "eswatini", "swaziland", "burundi",
    "libya", "mauritania",
  ]);

  return dedupeSnippets(
    items
      .filter((item) => {
        if (!item.startDate) return false;
        const start = new Date(item.startDate);
        if (Number.isNaN(start.getTime()) || start < now) return false;
        // Keep only conferences in African countries.
        const country = (item.country ?? "").toLowerCase().trim();
        return AFRICA_COUNTRY_NAMES.has(country);
      })
      .map((item) => {
        const cfpNote = item.cfpUrl
          ? ` CFP deadline: ${item.cfpEndDate ?? "TBA"}. Submit at ${item.cfpUrl}.`
          : "";
        return buildSnippet({
          title: item.name ?? "",
          summary: `Tech conference.${cfpNote}`,
          sourceName: "Confs.tech",
          sourceType: "WEBSITE",
          sourceUrl: item.url ?? "",
          registrationUrl: item.url ?? "",
          startDate: item.startDate,
          endDate: item.endDate,
          city: item.city,
          country: item.country,
        });
      })
      .filter((item): item is SourceSnippet => item !== null),
  );
};

// Fetch open hackathons from the Devpost public API.
const collectDevpostHackathons = async (): Promise<SourceSnippet[]> => {
  interface DevpostHackathon {
    title?: string;
    url?: string;
    thumbnail_url?: string;
    submission_period_dates?: string;
    prize_amount?: string;
    open_state?: string;
    displayed_location?: { location?: string };
    themes?: Array<{ name?: string }>;
  }

  interface DevpostResponse {
    hackathons?: DevpostHackathon[];
  }

  const url = new URL("https://devpost.com/api/hackathons.json");
  url.searchParams.set("order_by", "deadline");
  url.searchParams.set("status[]", "open");

  const data = await fetchJson<DevpostResponse>(url.toString());
  if (!data?.hackathons?.length) {
    return [];
  }

  return dedupeSnippets(
    data.hackathons
      .map((item) => {
        const themes = item.themes
          ?.map((t) => t.name)
          .filter(Boolean)
          .join(", ");
        const prize = item.prize_amount
          ? `Prize pool: $${item.prize_amount}.`
          : "";
        const dates = item.submission_period_dates ?? "";
        const summary = [dates, prize, themes].filter(Boolean).join(" ");

        return buildSnippet({
          title: item.title ?? "",
          summary: summary || "Open hackathon.",
          sourceName: "Devpost",
          sourceType: "WEBSITE",
          sourceUrl: item.url ?? "",
          registrationUrl: item.url ?? "",
          city: item.displayed_location?.location ?? "Online",
          imageUrl: item.thumbnail_url,
        });
      })
      .filter((item): item is SourceSnippet => item !== null),
  );
};

// Fetch upcoming events from Google Developer Groups (GDG) community platform.
const collectGdgCommunityEvents = async (): Promise<SourceSnippet[]> => {
  interface GdgEvent {
    id?: number;
    title?: string;
    description_short?: string;
    start_date?: string;
    end_date?: string;
    url?: string;
    picture?: string;
    chapter?: {
      title?: string;
      city?: string;
      country?: string;
    };
  }

  interface GdgResponse {
    results?: GdgEvent[];
  }

  const url = new URL("https://gdg.community.dev/api/event/");
  url.searchParams.set("format", "json");
  url.searchParams.set(
    "fields",
    "id,title,description_short,start_date,end_date,url,picture,chapter",
  );
  url.searchParams.set("ordering", "start_date");
  url.searchParams.set(
    "start_date__gte",
    new Date().toISOString().slice(0, 10),
  );
  url.searchParams.set("page_size", "50");

  const data = await fetchJson<GdgResponse>(url.toString());
  if (!data?.results?.length) {
    return [];
  }

  return dedupeSnippets(
    data.results
      // Keep only GDG chapters based in African countries.
      .filter((item) => {
        const country = (item.chapter?.country ?? "").toUpperCase();
        return AFRICAN_ISO_CODES.has(country);
      })
      .map((item) =>
        buildSnippet({
          title: item.title ?? "",
          summary: item.description_short ?? "",
          sourceName: item.chapter?.title
            ? `GDG ${item.chapter.title}`
            : "Google Developer Groups",
          sourceType: "COMMUNITY",
          sourceUrl: item.url ?? "",
          registrationUrl: item.url ?? "",
          startDate: item.start_date,
          endDate: item.end_date,
          city: item.chapter?.city,
          country: item.chapter?.country,
          imageUrl: item.picture,
        }),
      )
      .filter((item): item is SourceSnippet => item !== null),
  );
};

export const collectExternalSourceSnippets = async (): Promise<SourceSnippet[]> => {
  const [
    eventbrite,
    hashnode,
    rss,
    xPosts,
    reddit,
    bluesky,
    confsTech,
    devpost,
    gdg,
    serpResults,
    braveResults,
  ] = await Promise.all([
    collectEventbriteSnippets(),
    collectHashnodeSnippets(),
    collectRssSnippets(),
    collectXSnippets(),
    collectRedditSnippets(),
    collectBlueskySnippets(),
    collectConfsTechEvents(),
    collectDevpostHackathons(),
    collectGdgCommunityEvents(),
    collectSerpApiResults(),
    collectBraveResults(),
  ]);

  const searchResults = [...serpResults, ...braveResults];
  const searchSnippets = mapSearchResultsToSnippets(searchResults);
  const searchSources = mapSearchResultsToScrapeSources(searchResults);

  const scrapedFromSearch =
    searchSources.length > 0
      ? await scrapeSourcesForSnippets(
          searchSources.map((source) => ({
            name: source.name,
            type: source.type,
            url: source.url,
          })),
        )
      : [];

  return dedupeSnippets([
    ...eventbrite,
    ...confsTech,
    ...devpost,
    ...gdg,
    ...xPosts,
    ...reddit,
    ...bluesky,
    ...hashnode,
    ...rss,
    ...searchSnippets,
    ...scrapedFromSearch,
  ]);
};
