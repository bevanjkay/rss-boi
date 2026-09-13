import type { EntryDto, EntryListItemDto, SubscriptionDto, UserDto } from "@rss-boi/shared";
import type { Entry, Prisma, Subscription, User } from "../../../../prisma/generated/client/index.js";
import { getPlainTextFromHtml } from "./downloads.js";

const ENTRY_PREVIEW_MAX_LENGTH = 280;

// Feeds keep the last failed response body (up to 10 MB) for debugging, so
// relation loads must never select the whole row.
export const feedSummarySelect = {
  id: true,
  url: true,
  title: true,
  siteUrl: true,
  description: true,
  lastFetchedAt: true,
  lastSuccessAt: true,
  nextFetchAt: true,
  lastError: true,
  failureCount: true,
} satisfies Prisma.FeedSelect;

export const entryFeedSelect = {
  id: true,
  title: true,
  siteUrl: true,
} satisfies Prisma.FeedSelect;

type FeedSummaryRecord = Prisma.FeedGetPayload<{ select: typeof feedSummarySelect }>;
type EntryFeedRecord = Prisma.FeedGetPayload<{ select: typeof entryFeedSelect }>;

type EntryBaseDto = Omit<EntryListItemDto, "preview">;

type SerializableEntry = Pick<Entry, "author" | "contentHtml" | "id" | "publishedAt" | "summary" | "title" | "url"> & {
  feed: EntryFeedRecord;
  entryStates: Array<{
    isRead: boolean;
  }>;
};

export function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    defaultPollMinutes: user.defaultPollMinutes,
    mustChangePassword: user.mustChangePassword,
  };
}

export function serializeSubscription(
  subscription: Subscription & { feed: FeedSummaryRecord; user: Pick<User, "defaultPollMinutes"> },
  unreadCount = 0,
): SubscriptionDto {
  return {
    id: subscription.id,
    displayName: subscription.displayName,
    enabled: subscription.enabled,
    includeInAggregateViews: subscription.includeInAggregateViews,
    overridePollMinutes: subscription.overridePollMinutes,
    overrideFetchTimeoutSeconds: subscription.overrideFetchTimeoutSeconds,
    effectivePollMinutes: subscription.overridePollMinutes ?? subscription.user.defaultPollMinutes,
    unreadCount,
    feed: {
      id: subscription.feed.id,
      url: subscription.feed.url,
      title: subscription.feed.title,
      siteUrl: subscription.feed.siteUrl,
      description: subscription.feed.description,
      lastFetchedAt: subscription.feed.lastFetchedAt?.toISOString() ?? null,
      lastSuccessAt: subscription.feed.lastSuccessAt?.toISOString() ?? null,
      nextFetchAt: subscription.feed.nextFetchAt?.toISOString() ?? null,
      lastError: subscription.feed.lastError,
      failureCount: subscription.feed.failureCount,
    },
  };
}

function serializeEntryBase(entry: SerializableEntry): EntryBaseDto {
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url ?? entry.feed.siteUrl ?? null,
    author: entry.author,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    isRead: entry.entryStates[0]?.isRead ?? false,
    feed: {
      id: entry.feed.id,
      title: entry.feed.title,
      siteUrl: entry.feed.siteUrl,
    },
  };
}

function getPreviewText(html: string | null): string {
  return html ? getPlainTextFromHtml(html).replace(/\s+/g, " ").trim() : "";
}

function getEntryPreview(entry: Pick<Entry, "contentHtml" | "summary">): string {
  // Only fall through to the full article body when the summary yields
  // nothing, so a list page does not process 25 complete articles.
  const text = getPreviewText(entry.summary) || getPreviewText(entry.contentHtml);

  // Cut on code points so a boundary inside an emoji cannot leave a lone
  // surrogate at the end of the preview.
  const codePoints = Array.from(text);

  return codePoints.length > ENTRY_PREVIEW_MAX_LENGTH
    ? `${codePoints.slice(0, ENTRY_PREVIEW_MAX_LENGTH).join("").trimEnd()}…`
    : text;
}

export function serializeEntryListItem(entry: SerializableEntry): EntryListItemDto {
  return {
    ...serializeEntryBase(entry),
    preview: getEntryPreview(entry),
  };
}

export function serializeEntry(entry: SerializableEntry): EntryDto {
  return {
    ...serializeEntryBase(entry),
    summary: entry.summary,
    contentHtml: entry.contentHtml,
  };
}
