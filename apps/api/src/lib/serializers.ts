import type { EntryDto, SubscriptionDto, UserDto } from "@rss-boi/shared";
import type { Entry, Feed, Subscription, User } from "../../../../prisma/generated/client/index.js";

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
  subscription: Subscription & { feed: Feed; user: User },
  unreadCount = 0,
): SubscriptionDto {
  return {
    id: subscription.id,
    displayName: subscription.displayName,
    enabled: subscription.enabled,
    overridePollMinutes: subscription.overridePollMinutes,
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

export function serializeEntry(
  entry: Entry & {
    feed: Feed;
    entryStates: Array<{
      isRead: boolean;
    }>;
  },
): EntryDto {
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    author: entry.author,
    summary: entry.summary,
    contentHtml: entry.contentHtml,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    isRead: entry.entryStates[0]?.isRead ?? false,
    feed: {
      id: entry.feed.id,
      title: entry.feed.title,
      siteUrl: entry.feed.siteUrl,
    },
  };
}
