import type Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import { prisma } from "../db.js";
import { computeGuidHash, sanitizeUrl } from "./shared.js";

type ParsedFeed = Awaited<ReturnType<Parser["parseString"]>>;

const sanitizeFeedHtmlOptions: sanitizeHtml.IOptions = {
  ...sanitizeHtml.defaults,
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["alt", "loading", "referrerpolicy", "src", "title"],
  },
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
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
  await prisma.feed.update({
    where: { id: feedId },
    data: {
      title: parsedFeed.title ?? null,
      siteUrl: parsedFeed.link ? sanitizeUrl(parsedFeed.link) : null,
      description: parsedFeed.description ?? null,
    },
  });

  for (const item of parsedFeed.items) {
    const stableId = item.guid ?? item.id ?? item.link ?? `${item.title ?? "untitled"}-${item.pubDate ?? ""}`;
    const link = item.link ? sanitizeUrl(item.link) : null;

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
