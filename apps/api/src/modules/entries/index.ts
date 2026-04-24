import type { FastifyPluginAsync } from "fastify";
import { entryQuerySchema } from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { serializeEntry } from "../../lib/serializers.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const entriesModule: FastifyPluginAsync = async (fastify) => {
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
          some: {
            userId: request.user!.id,
            enabled: true,
          },
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
      ...(query.status === "unread"
        ? {
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
          }
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

  fastify.post("/entries/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: {
        id,
        feed: {
          subscriptions: {
            some: {
              userId: request.user!.id,
            },
          },
        },
      },
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
      where: {
        id,
        feed: {
          subscriptions: {
            some: {
              userId: request.user!.id,
            },
          },
        },
      },
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
