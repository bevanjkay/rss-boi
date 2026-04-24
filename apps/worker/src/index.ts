import type { Prisma } from "../../../prisma/generated/client/index.js";
import process from "node:process";
import pino from "pino";
import { env } from "./config.js";
import { prisma } from "./db.js";
import { fetchFeed } from "./poller/fetch-feed.js";
import { parseFeed } from "./poller/parse-feed.js";
import { computeEffectiveInterval, getDueFeeds, setNextFetch } from "./poller/scheduler.js";
import { upsertFeedContent } from "./poller/upsert-entries.js";

const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info"),
  name: "rss-boi-worker",
});
const MAX_STORED_RESPONSE_CHARS = 100_000;

function truncateResponseBody(body: string): string {
  return body.length > MAX_STORED_RESPONSE_CHARS
    ? `${body.slice(0, MAX_STORED_RESPONSE_CHARS)}\n\n[truncated]`
    : body;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    value: error,
  };
}

async function processFeed(feedId: string) {
  const feed = await prisma.feed.findUnique({
    where: { id: feedId },
  });

  if (!feed)
    return;

  const interval = await computeEffectiveInterval(feed.id);

  if (interval === null) {
    logger.info({ feedId: feed.id, feedUrl: feed.url }, "Skipping feed with no active subscriptions");
    await setNextFetch(feed.id, null);
    return;
  }

  let responseBody: string | null = null;
  let responseContentType: string | null = null;
  let responseStatus: number | null = null;

  try {
    logger.info({ feedId: feed.id, feedUrl: feed.url, intervalMinutes: interval }, "Refreshing feed");
    const response = await fetchFeed(feed);
    responseStatus = response.status;
    responseContentType = response.headers.get("content-type");
    logger.debug({ feedId: feed.id, responseContentType, responseStatus }, "Feed response received");

    if (response.status === 304) {
      const feedUpdate: Prisma.FeedUpdateInput = {
        lastFetchedAt: new Date(),
        lastError: null,
        failureCount: 0,
        lastResponseContentType: responseContentType,
        lastResponseStatus: responseStatus,
      };

      await prisma.feed.update({
        where: { id: feed.id },
        data: feedUpdate,
      });
      logger.info({ feedId: feed.id, responseStatus }, "Feed not modified");
      await setNextFetch(feed.id, interval, 0);
      return;
    }

    responseBody = truncateResponseBody(await response.text());

    if (!response.ok)
      throw new Error(`Unexpected response ${response.status}`);

    const parsed = await parseFeed(responseBody);
    logger.info({ feedId: feed.id, itemCount: parsed.items.length, responseStatus }, "Feed parsed successfully");

    await upsertFeedContent(feed.id, parsed);

    const feedUpdate: Prisma.FeedUpdateInput = {
      title: parsed.title ?? feed.title,
      siteUrl: parsed.link ?? feed.siteUrl,
      description: parsed.description ?? feed.description,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: null,
      failureCount: 0,
      lastResponseBody: responseBody,
      lastResponseContentType: responseContentType,
      lastResponseStatus: responseStatus,
    };

    await prisma.feed.update({
      where: { id: feed.id },
      data: feedUpdate,
    });

    logger.info({ feedId: feed.id, itemCount: parsed.items.length }, "Feed stored successfully");
    await setNextFetch(feed.id, interval, 0);
  }
  catch (error) {
    logger.error({ error: serializeError(error), feedId: feed.id, feedUrl: feed.url }, "Failed to refresh feed");

    const feedUpdate: Prisma.FeedUpdateInput = {
      lastFetchedAt: new Date(),
      lastError: error instanceof Error ? error.message : "Unknown error",
      lastResponseBody: responseBody,
      lastResponseContentType: responseContentType,
      lastResponseStatus: responseStatus,
      failureCount: {
        increment: 1,
      },
    };

    const updatedFeed = await prisma.feed.update({
      where: { id: feed.id },
      data: feedUpdate,
    });

    await setNextFetch(feed.id, interval, updatedFeed.failureCount);
  }
}

async function tick() {
  const dueFeeds = await getDueFeeds();
  logger.debug({ dueFeedCount: dueFeeds.length }, "Worker tick");

  for (const feed of dueFeeds)
    await processFeed(feed.id);
}

async function main() {
  logger.info({ env: env.NODE_ENV, logLevel: logger.level }, "Worker started");

  while (true) {
    try {
      await tick();
    }
    catch (error) {
      logger.error({ error: serializeError(error) }, "Worker tick failed");
    }

    await new Promise(resolve => setTimeout(resolve, 30_000));
  }
}

void main().catch((error) => {
  logger.error({ error: serializeError(error) }, "Worker crashed");
  process.exit(1);
});
