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

export async function upsertFeedContent(feedId: string, parsedFeed: ParsedFeed): Promise<void> {
  const feedSiteUrl = parsedFeed.link ? sanitizeUrl(parsedFeed.link) : null;

  await prisma.feed.update({
    where: { id: feedId },
    data: {
      title: parsedFeed.title ?? null,
      siteUrl: feedSiteUrl,
      description: parsedFeed.description ?? null,
    },
  });

  for (const item of parsedFeed.items) {
    const stableId = item.guid ?? item.id ?? item.link ?? `${item.title ?? "untitled"}-${item.pubDate ?? ""}`;
    const link = item.link ? sanitizeUrl(item.link) : feedSiteUrl;

    const publishedAt = item.isoDate
      ? new Date(item.isoDate)
      : item.pubDate
        ? new Date(item.pubDate)
        : null;
    const contentHtml = getEntryContentHtml(item);

    await prisma.entry.upsert({
      where: {
        feedId_guidHash: {
          feedId,
          guidHash: computeGuidHash(stableId),
        },
      },
      update: {
        title: item.title ?? null,
        author: item.creator ?? null,
        summary: item.contentSnippet ?? item.summary ?? null,
        contentHtml,
        publishedAt,
        url: link,
      },
      create: {
        feedId,
        guidHash: computeGuidHash(stableId),
        title: item.title ?? null,
        url: link,
        author: item.creator ?? null,
        summary: item.contentSnippet ?? item.summary ?? null,
        contentHtml,
        publishedAt,
      },
    });
  }
}
