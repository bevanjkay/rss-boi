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
