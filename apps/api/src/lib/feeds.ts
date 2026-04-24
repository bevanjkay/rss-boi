import { prisma } from "../db/client.js";

export function normalizeFeedUrl(input: string): string {
  const url = new URL(input.trim());

  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only http and https feeds are supported.");

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (url.pathname === "/")
    url.pathname = "";

  return url.toString();
}

export async function refreshFeedSchedule(feedId: string): Promise<void> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      feedId,
      user: {
        status: "ACTIVE",
      },
    },
    include: {
      user: true,
    },
  });

  if (!subscriptions.length) {
    await prisma.feed.update({
      where: { id: feedId },
      data: { nextFetchAt: null },
    });
    return;
  }

  const effectivePollMinutes = Math.min(
    ...subscriptions.map(subscription => subscription.overridePollMinutes ?? subscription.user.defaultPollMinutes),
  );

  const nextFetchAt = new Date(Date.now() + effectivePollMinutes * 60_000);

  await prisma.feed.update({
    where: { id: feedId },
    data: { nextFetchAt },
  });
}

export async function queueFeedRefresh(feedId: string): Promise<void> {
  await prisma.feed.update({
    where: { id: feedId },
    data: {
      nextFetchAt: new Date(),
    },
  });
}
