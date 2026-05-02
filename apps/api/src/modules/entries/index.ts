import type { FastifyPluginAsync } from "fastify";
import { bulkMarkReadInputSchema, entryQuerySchema } from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { serializeEntry } from "../../lib/serializers.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const entriesModule: FastifyPluginAsync = async (fastify) => {
  const getSubscriptionScopeFilter = (userId: string, options?: { aggregateOnly?: boolean }) => ({
    some: {
      userId,
      enabled: true,
      ...(options?.aggregateOnly
        ? {
            includeInAggregateViews: true,
          }
        : {}),
    },
  });

  const getUnreadStateFilter = (userId: string) => ({
    OR: [
      {
        entryStates: {
          none: {
            userId,
          },
        },
      },
      {
        entryStates: {
          some: {
            userId,
            isRead: false,
          },
        },
      },
    ],
  });

  const getEntryWhereForUser = (userId: string, id: string) => ({
    id,
    feed: {
      subscriptions: {
        ...getSubscriptionScopeFilter(userId),
      },
    },
  });

  fastify.get("/entries", { preHandler: requireAuth }, async (request, reply) => {
    const query = entryQuerySchema.parse(request.query);

    if (query.feedId) {
      const hasSubscription = await prisma.subscription.findFirst({
        where: {
          feedId: query.feedId,
          userId: request.user!.id,
        },
      });

      if (!hasSubscription)
        return reply.code(404).send({ message: "Feed not found." });
    }

    const where = {
      feed: {
        subscriptions: {
          ...getSubscriptionScopeFilter(request.user!.id, { aggregateOnly: !query.feedId }),
        },
      },
      ...(query.feedId
        ? {
            feedId: query.feedId,
          }
        : {}),
      ...(query.cursor
        ? {
            id: {
              lt: query.cursor,
            },
          }
        : {}),
      ...(query.publishedAfter || query.publishedBefore
        ? {
            publishedAt: {
              ...(query.publishedAfter
                ? {
                    gte: new Date(query.publishedAfter),
                  }
                : {}),
              ...(query.publishedBefore
                ? {
                    lt: new Date(query.publishedBefore),
                  }
                : {}),
            },
          }
        : {}),
      ...(query.status === "unread"
        ? getUnreadStateFilter(request.user!.id)
        : {}),
    };

    const entries = await prisma.entry.findMany({
      where,
      take: query.limit + 1,
      orderBy: [
        { publishedAt: "desc" },
        { id: "desc" },
      ],
      include: {
        feed: true,
        entryStates: {
          where: {
            userId: request.user!.id,
          },
          select: {
            isRead: true,
          },
        },
      },
    });

    const hasMore = entries.length > query.limit;
    const page = hasMore ? entries.slice(0, query.limit) : entries;

    return {
      entries: page.map(entry => serializeEntry(entry)),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  });

  fastify.post("/entries/read", { preHandler: requireAuth }, async (request, reply) => {
    const input = bulkMarkReadInputSchema.parse(request.body ?? {});

    if (input.feedId) {
      const hasSubscription = await prisma.subscription.findFirst({
        where: {
          feedId: input.feedId,
          userId: request.user!.id,
        },
      });

      if (!hasSubscription)
        return reply.code(404).send({ message: "Feed not found." });
    }

    const unreadEntries = await prisma.entry.findMany({
      where: {
        feed: {
          subscriptions: {
            ...getSubscriptionScopeFilter(request.user!.id, { aggregateOnly: !input.feedId }),
          },
        },
        ...(input.feedId
          ? {
              feedId: input.feedId,
            }
          : {}),
        ...getUnreadStateFilter(request.user!.id),
      },
      select: {
        id: true,
      },
    });

    if (!unreadEntries.length)
      return reply.code(204).send();

    const entryIds = unreadEntries.map(entry => entry.id);
    const now = new Date();

    await prisma.$transaction([
      prisma.userEntryState.createMany({
        data: entryIds.map(entryId => ({
          userId: request.user!.id,
          entryId,
          isRead: true,
          readAt: now,
        })),
        skipDuplicates: true,
      }),
      prisma.userEntryState.updateMany({
        where: {
          userId: request.user!.id,
          entryId: {
            in: entryIds,
          },
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: now,
        },
      }),
    ]);

    return reply.code(204).send();
  });

  fastify.get("/entries/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
      include: {
        feed: true,
        entryStates: {
          where: {
            userId: request.user!.id,
          },
          select: {
            isRead: true,
          },
        },
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    return serializeEntry(entry);
  });

  fastify.post("/entries/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    await prisma.userEntryState.upsert({
      where: {
        userId_entryId: {
          userId: request.user!.id,
          entryId: id,
        },
      },
      create: {
        userId: request.user!.id,
        entryId: id,
        isRead: true,
        readAt: new Date(),
      },
      update: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return reply.code(204).send();
  });

  fastify.post("/entries/:id/unread", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    await prisma.userEntryState.upsert({
      where: {
        userId_entryId: {
          userId: request.user!.id,
          entryId: id,
        },
      },
      create: {
        userId: request.user!.id,
        entryId: id,
        isRead: false,
        readAt: null,
      },
      update: {
        isRead: false,
        readAt: null,
      },
    });

    return reply.code(204).send();
  });
};
