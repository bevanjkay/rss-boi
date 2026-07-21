import type { ParsedFeed } from "./parse-feed.js";
import sanitizeHtml from "sanitize-html";
import { prisma } from "../db.js";
import { computeGuidHash, sanitizeUrl } from "./shared.js";

const sanitizeFeedHtmlOptions: sanitizeHtml.IOptions = {
  ...sanitizeHtml.defaults,
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    iframe: ["allow", "allowfullscreen", "frameborder", "height", "loading", "referrerpolicy", "sandbox", "src", "title", "width"],
    img: ["alt", "loading", "referrerpolicy", "src", "title"],
    source: ["src", "type"],
    video: ["controls", "height", "loop", "muted", "playsinline", "poster", "preload", "src", "width"],
  },
  allowedIframeHostnames: [
    "www.youtube.com",
    "www.youtube-nocookie.com",
    "player.vimeo.com",
    "open.spotify.com",
    "w.soundcloud.com",
    "embed.podcasts.apple.com",
  ],
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "iframe", "img", "source", "video"],
};

function sanitizeFeedHtml(value: string | null | undefined): string | null {
  if (!value)
    return null;

  return sanitizeHtml(value, sanitizeFeedHtmlOptions);
}

function getEntryContentHtml(item: ParsedFeed["items"][number]): string | null {
  return sanitizeFeedHtml(item["content:encoded"] ?? item.content ?? item.summary ?? null);
}

function safeSanitizeUrl(value: string | null | undefined): string | null {
  if (!value)
    return null;

  try {
    return sanitizeUrl(value);
  }
  catch {
    return null;
  }
}

function parsePublishedAt(item: ParsedFeed["items"][number]): Date | null {
  const raw = item.isoDate ?? item.pubDate;

  if (!raw)
    return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface UpsertResult {
  skipped: number;
  upserted: number;
}

export async function upsertFeedContent(feedId: string, parsedFeed: ParsedFeed): Promise<UpsertResult> {
  const feedSiteUrl = safeSanitizeUrl(parsedFeed.link);

  await prisma.feed.update({
    where: { id: feedId },
    data: {
      title: parsedFeed.title ?? null,
      siteUrl: feedSiteUrl,
      description: parsedFeed.description ?? null,
    },
  });

  let upserted = 0;
  let skipped = 0;

  for (const item of parsedFeed.items) {
    try {
      const stableId = item.guid ?? item.id ?? item.link ?? `${item.title ?? "untitled"}-${item.pubDate ?? ""}`;
      const guidHash = computeGuidHash(stableId);
      const link = safeSanitizeUrl(item.link) ?? feedSiteUrl;
      const publishedAt = parsePublishedAt(item);
      const contentHtml = getEntryContentHtml(item);
      const summary = sanitizeFeedHtml(item.contentSnippet ?? item.summary ?? null);

      await prisma.entry.upsert({
        where: {
          feedId_guidHash: {
            feedId,
            guidHash,
          },
        },
        update: {
          title: item.title ?? null,
          author: item.creator ?? null,
          summary,
          contentHtml,
          publishedAt,
          url: link,
        },
        create: {
          feedId,
          guidHash,
          title: item.title ?? null,
          url: link,
          author: item.creator ?? null,
          summary,
          contentHtml,
          publishedAt,
        },
      });

      upserted++;
    }
    catch {
      skipped++;
    }
  }

  return { skipped, upserted };
}
