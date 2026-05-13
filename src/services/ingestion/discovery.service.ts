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

const DEFAULT_HASHNODE_HOSTS = [
  "engineering.hashnode.com",
  "blog.developerdao.com",
];

const DEFAULT_RSS_FEEDS = [
  "https://blog.google/rss/",
  "https://github.blog/feed/",
  "https://developer.mozilla.org/en-US/blog/rss.xml",
  "https://aws.amazon.com/blogs/devops/feed/",
];

const LUMA_SEED_URLS = [
  "https://lu.ma/discover",
  "https://lu.ma/calendar",
];

const LINKEDIN_EVENT_SEED_URLS = [
  "https://www.linkedin.com/events/",
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

const SEARCH_QUERIES = [
  "site:lu.ma (tech OR developer) (event OR meetup OR workshop)",
  "site:linkedin.com/events (tech OR software) (conference OR meetup OR workshop)",
  "(tech OR software) (event OR meetup OR conference) (eventbrite OR meetup OR lu.ma)",
];

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

  const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
  url.searchParams.set("q", "tech meetup workshop conference hackathon");
  url.searchParams.set("expand", "venue");
  url.searchParams.set("sort_by", "date");

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

const collectMeetupSnippets = async (): Promise<SourceSnippet[]> => {
  if (!env.MEETUP_API_KEY) {
    return [];
  }

  interface MeetupResponse {
    events?: Array<{
      name?: string;
      description?: string;
      local_date?: string;
      local_time?: string;
      link?: string;
      venue?: {
        city?: string;
        country?: string;
        name?: string;
      };
      group?: {
        name?: string;
      };
    }>;
  }

  const url = new URL("https://api.meetup.com/find/upcoming_events");
  url.searchParams.set("key", env.MEETUP_API_KEY);
  url.searchParams.set("text", "tech");
  url.searchParams.set("page", "60");
  url.searchParams.set("topic_category", "292");

  const data = await fetchJson<MeetupResponse>(url.toString());
  if (!data?.events?.length) {
    return [];
  }

  return dedupeSnippets(
    data.events
      .map((item) =>
        buildSnippet({
          title: item.name ?? "",
          summary: item.description ?? "",
          sourceName: item.group?.name
            ? `Meetup API • ${item.group.name}`
            : "Meetup API",
          sourceType: "COMMUNITY",
          sourceUrl: item.link ?? "",
          registrationUrl: item.link ?? "",
          startDate:
            item.local_date && item.local_time
              ? `${item.local_date}T${item.local_time}`
              : item.local_date ?? undefined,
          city: item.venue?.city ?? undefined,
          country: item.venue?.country ?? undefined,
          venue: item.venue?.name ?? undefined,
        }),
      )
      .filter((item): item is SourceSnippet => item !== null),
  );
};

const collectDevToSnippets = async (): Promise<SourceSnippet[]> => {
  interface DevToArticle {
    title: string;
    description: string;
    url: string;
    social_image?: string | null;
    published_at?: string;
    tag_list?: string[] | string;
    user?: {
      name?: string;
    };
  }

  const tags = ["events", "webdev", "devops", "ai"];
  const batches = await Promise.all(
    tags.map((tag) =>
      fetchJson<DevToArticle[]>(
        `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=25`,
      ),
    ),
  );

  const articles = batches.flatMap((batch) => batch ?? []);
  if (!articles.length) {
    return [];
  }

  return dedupeSnippets(
    articles
      .map((item) => {
        const tagText = Array.isArray(item.tag_list)
          ? item.tag_list.join(", ")
          : item.tag_list ?? "";
        return buildSnippet({
          title: item.title,
          summary: `${item.description ?? ""} ${tagText}`.trim(),
          sourceName: item.user?.name
            ? `Dev.to • ${item.user.name}`
            : "Dev.to",
          sourceType: "NEWSLETTER",
          sourceUrl: item.url,
          registrationUrl: item.url,
          startDate: item.published_at,
          imageUrl: item.social_image ?? undefined,
        });
      })
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

const collectXSnippets = async (): Promise<SourceSnippet[]> => {
  if (!env.X_API_BEARER_TOKEN) {
    return [];
  }

  interface XSearchResponse {
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
    }>;
  }

  const query =
    "(tech OR developer OR software) (meetup OR conference OR workshop OR hackathon) -is:retweet lang:en";
  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "30");
  url.searchParams.set("tweet.fields", "created_at");

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
      .map((tweet) =>
        buildSnippet({
          title: `X Event Announcement`,
          summary: tweet.text,
          sourceName: "X API",
          sourceType: "SOCIAL_MEDIA",
          sourceUrl: `https://x.com/i/web/status/${tweet.id}`,
          registrationUrl: `https://x.com/i/web/status/${tweet.id}`,
          startDate: tweet.created_at ?? undefined,
        }),
      )
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

    if (sourceUrl.includes("lu.ma") || sourceUrl.includes("linkedin.com/events")) {
      pushSource({
        name: result.sourceName,
        type: result.sourceType,
        url: sourceUrl,
      });
    }
  }

  for (const seedUrl of [...LUMA_SEED_URLS, ...LINKEDIN_EVENT_SEED_URLS]) {
    const url = safeUrl(seedUrl);
    if (!url) {
      continue;
    }
    pushSource({
      name: url.includes("lu.ma") ? "Luma Discovery" : "LinkedIn Events Discovery",
      type: url.includes("linkedin.com") ? "SOCIAL_MEDIA" : "COMMUNITY",
      url,
    });
  }

  return sources.slice(0, 25);
};

export const collectExternalSourceSnippets = async (): Promise<SourceSnippet[]> => {
  const [eventbrite, meetup, devto, hashnode, rss, xPosts, serpResults, braveResults] =
    await Promise.all([
      collectEventbriteSnippets(),
      collectMeetupSnippets(),
      collectDevToSnippets(),
      collectHashnodeSnippets(),
      collectRssSnippets(),
      collectXSnippets(),
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
    ...meetup,
    ...devto,
    ...hashnode,
    ...rss,
    ...xPosts,
    ...searchSnippets,
    ...scrapedFromSearch,
  ]);
};
