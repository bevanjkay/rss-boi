import Parser from "rss-parser";

const rssParser = new Parser();

interface ParsedItem {
  "content:encoded"?: string | undefined;
  "content"?: string | undefined;
  "contentSnippet"?: string | undefined;
  "creator"?: string | undefined;
  "guid"?: string | undefined;
  "id"?: string | undefined;
  "isoDate"?: string | undefined;
  "link"?: string | undefined;
  "pubDate"?: string | undefined;
  "summary"?: string | undefined;
  "title"?: string | undefined;
}

export interface ParsedFeed {
  description?: string | undefined;
  items: ParsedItem[];
  link?: string | undefined;
  title?: string | undefined;
}

interface JsonFeedItem {
  authors?: Array<{ name?: string }>;
  author?: { name?: string };
  content_html?: string;
  content_text?: string;
  date_published?: string;
  external_url?: string;
  id?: string;
  summary?: string;
  title?: string;
  url?: string;
}

interface JsonFeedDocument {
  author?: { name?: string };
  authors?: Array<{ name?: string }>;
  description?: string;
  feed_url?: string;
  home_page_url?: string;
  items?: JsonFeedItem[];
  title?: string;
  version?: string;
}

function hasJsonFeedContentType(contentType: string | null | undefined): boolean {
  if (!contentType)
    return false;

  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return mime === "application/feed+json" || mime === "application/json";
}

function isJsonFeed(source: string, contentType?: string | null): boolean {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("{"))
    return false;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.version === "string" && parsed.version.startsWith("https://jsonfeed.org/version/"))
      return true;

    return hasJsonFeedContentType(contentType) && typeof parsed.items !== "undefined";
  }
  catch {
    return false;
  }
}

function parseJsonFeedSource(source: string): ParsedFeed {
  const doc: JsonFeedDocument = JSON.parse(source);

  const items: ParsedItem[] = (doc.items ?? []).map((item) => {
    const authorName
      = item.authors?.[0]?.name
        ?? item.author?.name
        ?? doc.authors?.[0]?.name
        ?? doc.author?.name;

    return {
      "content:encoded": item.content_html ?? undefined,
      "content": item.content_html ?? item.content_text ?? undefined,
      "contentSnippet": item.summary ?? item.content_text?.slice(0, 280) ?? undefined,
      "creator": authorName,
      "guid": item.id ?? undefined,
      "id": item.id ?? undefined,
      "isoDate": item.date_published ?? undefined,
      "link": item.url ?? item.external_url ?? undefined,
      "summary": item.summary ?? item.content_text?.slice(0, 280) ?? undefined,
      "title": item.title ?? undefined,
    };
  });

  return {
    description: doc.description,
    items,
    link: doc.home_page_url,
    title: doc.title,
  };
}

export async function parseFeed(source: string, contentType?: string | null): Promise<ParsedFeed> {
  if (isJsonFeed(source, contentType))
    return parseJsonFeedSource(source);

  return rssParser.parseString(source);
}
