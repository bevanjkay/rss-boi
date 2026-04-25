import { prisma } from "../db.js";

export async function getDueFeeds(limit = 10) {
  return prisma.feed.findMany({
    where: {
      nextFetchAt: {
        lte: new Date(),
      },
      subscriptions: {
        some: {
          enabled: true,
          user: {
            status: "ACTIVE",
          },
        },
      },
    },
    take: limit,
    orderBy: {
      nextFetchAt: "asc",
    },
  });
}

const DEFAULT_FETCH_TIMEOUT_SECONDS = 15;
const MAX_FETCH_TIMEOUT_SECONDS = 60;

export async function computeEffectiveInterval(feedId: string): Promise<number | null> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      feedId,
      enabled: true,
      user: {
        status: "ACTIVE",
      },
    },
    include: {
      user: true,
    },
  });

  if (!subscriptions.length)
    return null;

  return Math.min(
    ...subscriptions.map(subscription => subscription.overridePollMinutes ?? subscription.user.defaultPollMinutes),
  );
}

export async function computeEffectiveFetchTimeout(feedId: string): Promise<number> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      feedId,
      enabled: true,
      user: {
        status: "ACTIVE",
      },
    },
    select: {
      overrideFetchTimeoutSeconds: true,
    },
  });

  if (!subscriptions.length)
    return DEFAULT_FETCH_TIMEOUT_SECONDS;

  const overrides = subscriptions
    .map(s => s.overrideFetchTimeoutSeconds)
    .filter((v): v is number => v !== null);

  if (!overrides.length)
    return DEFAULT_FETCH_TIMEOUT_SECONDS;

  return Math.min(Math.max(...overrides), MAX_FETCH_TIMEOUT_SECONDS);
}

export async function setNextFetch(feedId: string, intervalMinutes: number | null, failureCount = 0): Promise<void> {
  const backoffMinutes = failureCount > 0
    ? Math.min(60, 2 ** Math.min(failureCount, 5))
    : 0;
  const effectiveInterval = intervalMinutes === null
    ? null
    : Math.max(intervalMinutes, backoffMinutes);

  await prisma.feed.update({
    where: { id: feedId },
    data: {
      nextFetchAt: effectiveInterval === null
        ? null
        : new Date(Date.now() + effectiveInterval * 60_000),
    },
  });
}
