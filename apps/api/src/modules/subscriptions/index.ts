import type { FastifyPluginAsync } from "fastify";
import {
  createSubscriptionInputSchema,
  feedDebugSchema,
  subscriptionImportResultSchema,
  subscriptionTransferSchema,
  updateSubscriptionInputSchema,
} from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { normalizeFeedUrl, queueFeedRefresh, refreshFeedSchedule } from "../../lib/feeds.js";
import { serializeSubscription } from "../../lib/serializers.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const subscriptionsModule: FastifyPluginAsync = async (fastify) => {
  fastify.get("/subscriptions", { preHandler: requireAuth }, async (request) => {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: request.user!.id },
      include: {
        feed: true,
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const unreadCounts = await Promise.all(
      subscriptions.map(async (subscription) => {
        const count = await prisma.entry.count({
          where: {
            feedId: subscription.feedId,
            OR: [
              {
                entryStates: {
                  none: {
                    userId: request.user!.id,
                  },
                },
              },
              {
                entryStates: {
                  some: {
                    userId: request.user!.id,
                    isRead: false,
                  },
                },
              },
            ],
          },
        });

        return [subscription.id, count] as const;
      }),
    );

    const unreadCountBySubscriptionId = new Map(unreadCounts);

    return subscriptions.map(subscription =>
      serializeSubscription(subscription, unreadCountBySubscriptionId.get(subscription.id) ?? 0),
    );
  });

  fastify.get("/subscriptions/export", { preHandler: requireAuth }, async (request) => {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: request.user!.id },
      include: {
        feed: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return subscriptionTransferSchema.parse({
      exportedAt: new Date().toISOString(),
      subscriptions: subscriptions.map(subscription => ({
        displayName: subscription.displayName,
        enabled: subscription.enabled,
        overrideFetchTimeoutSeconds: subscription.overrideFetchTimeoutSeconds,
        overridePollMinutes: subscription.overridePollMinutes,
        url: subscription.feed.url,
      })),
      type: "rss-boi/subscriptions",
      version: 1,
    });
  });

  fastify.post("/subscriptions/import", { preHandler: requireAuth }, async (request) => {
    const input = subscriptionTransferSchema.parse(request.body);
    let created = 0;
    let updated = 0;
    const affectedFeedIds = new Set<string>();
    const queuedFeedIds = new Set<string>();

    for (const subscription of input.subscriptions) {
      const normalizedUrl = normalizeFeedUrl(subscription.url);
      const feed = await prisma.feed.upsert({
        where: { url: normalizedUrl },
        update: {},
        create: { url: normalizedUrl },
      });

      const existing = await prisma.subscription.findUnique({
        where: {
          userId_feedId: {
            userId: request.user!.id,
            feedId: feed.id,
          },
        },
      });

      if (existing) {
        await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            displayName: subscription.displayName,
            enabled: subscription.enabled,
            overrideFetchTimeoutSeconds: subscription.overrideFetchTimeoutSeconds,
            overridePollMinutes: subscription.overridePollMinutes,
          },
        });
        updated += 1;
      }
      else {
        await prisma.subscription.create({
          data: {
            userId: request.user!.id,
            feedId: feed.id,
            displayName: subscription.displayName,
            enabled: subscription.enabled,
            overrideFetchTimeoutSeconds: subscription.overrideFetchTimeoutSeconds,
            overridePollMinutes: subscription.overridePollMinutes,
          },
        });
        created += 1;
      }

      affectedFeedIds.add(feed.id);

      if (subscription.enabled)
        queuedFeedIds.add(feed.id);
    }

    await Promise.all([...affectedFeedIds].map(refreshFeedSchedule));
    await Promise.all([...queuedFeedIds].map(queueFeedRefresh));

    return subscriptionImportResultSchema.parse({
      created,
      updated,
    });
  });

  fastify.post("/subscriptions", { preHandler: requireAuth }, async (request, reply) => {
    const input = createSubscriptionInputSchema.parse(request.body);
    const normalizedUrl = normalizeFeedUrl(input.url);

    const feed = await prisma.feed.upsert({
      where: { url: normalizedUrl },
      update: {},
      create: { url: normalizedUrl },
    });

    const existing = await prisma.subscription.findUnique({
      where: {
        userId_feedId: {
          userId: request.user!.id,
          feedId: feed.id,
        },
      },
    });

    if (existing)
      return reply.code(409).send({ message: "You already subscribe to this feed." });

    const subscription = await prisma.subscription.create({
      data: {
        userId: request.user!.id,
        feedId: feed.id,
        displayName: input.displayName ?? null,
        overridePollMinutes: input.overridePollMinutes ?? null,
        overrideFetchTimeoutSeconds: input.overrideFetchTimeoutSeconds ?? null,
      },
      include: {
        feed: true,
        user: true,
      },
    });

    await queueFeedRefresh(feed.id);

    return reply.code(201).send(serializeSubscription(subscription, 0));
  });

  fastify.patch("/subscriptions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateSubscriptionInputSchema.parse(request.body);

    const existing = await prisma.subscription.findFirst({
      where: {
        id,
        userId: request.user!.id,
      },
    });

    if (!existing)
      return reply.code(404).send({ message: "Subscription not found." });

    let nextFeedId = existing.feedId;
    const previousFeedId = existing.feedId;

    if (input.url) {
      const normalizedUrl = normalizeFeedUrl(input.url);
      const nextFeed = await prisma.feed.upsert({
        where: { url: normalizedUrl },
        update: {},
        create: { url: normalizedUrl },
      });

      const duplicate = await prisma.subscription.findFirst({
        where: {
          id: {
            not: id,
          },
          userId: request.user!.id,
          feedId: nextFeed.id,
        },
      });

      if (duplicate)
        return reply.code(409).send({ message: "You already subscribe to that feed URL." });

      nextFeedId = nextFeed.id;
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        displayName: input.displayName ?? null,
        enabled: input.enabled ?? existing.enabled,
        feedId: nextFeedId,
        overridePollMinutes: input.overridePollMinutes ?? null,
        overrideFetchTimeoutSeconds: input.overrideFetchTimeoutSeconds ?? null,
      },
      include: {
        feed: true,
        user: true,
      },
    });

    if (previousFeedId !== nextFeedId)
      await refreshFeedSchedule(previousFeedId);

    await queueFeedRefresh(subscription.feedId);

    return serializeSubscription(subscription, 0);
  });

  fastify.delete("/subscriptions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.subscription.findFirst({
      where: {
        id,
        userId: request.user!.id,
      },
    });

    if (!existing)
      return reply.code(404).send({ message: "Subscription not found." });

    await prisma.subscription.delete({
      where: { id },
    });

    await refreshFeedSchedule(existing.feedId);

    return reply.code(204).send();
  });

  fastify.post("/subscriptions/:id/refresh", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const subscription = await prisma.subscription.findFirst({
      where: {
        id,
        userId: request.user!.id,
      },
    });

    if (!subscription)
      return reply.code(404).send({ message: "Subscription not found." });

    if (!subscription.enabled)
      return reply.code(400).send({ message: "Enable the subscription before refreshing it." });

    await queueFeedRefresh(subscription.feedId);

    return reply.code(202).send({ message: "Feed refresh queued." });
  });

  fastify.get("/subscriptions/:id/debug", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const subscription = await prisma.subscription.findFirst({
      where: {
        id,
        userId: request.user!.id,
      },
      include: {
        feed: true,
      },
    });

    if (!subscription)
      return reply.code(404).send({ message: "Subscription not found." });

    return feedDebugSchema.parse({
      subscriptionId: subscription.id,
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
        lastResponseBody: subscription.feed.lastResponseBody,
        lastResponseContentType: subscription.feed.lastResponseContentType,
        lastResponseStatus: subscription.feed.lastResponseStatus,
      },
    });
  });
};
