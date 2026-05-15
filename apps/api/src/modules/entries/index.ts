import type { FastifyPluginAsync } from "fastify";
import { Buffer } from "node:buffer";
import { bulkMarkReadInputSchema, entryQuerySchema } from "@rss-boi/shared";
import { prisma } from "../../db/client.js";
import { createPdfBuffer, createZipBuffer, getImageExtension, getImageSourcesFromHtml, getPdfImage, getPlainTextFromHtml, getSafeDownloadName } from "../../lib/downloads.js";
import { serializeEntry } from "../../lib/serializers.js";
import { requireAuth } from "../../middleware/require-auth.js";

export const entriesModule: FastifyPluginAsync = async (fastify) => {
  const getEntryArticleHtml = (entry: { contentHtml: string | null; summary: string | null }) =>
    entry.contentHtml ?? `<p>${entry.summary ?? "No article content was captured for this entry."}</p>`;

  const getEntrySourceUrl = (entry: { feed: { siteUrl: string | null }; url: string | null }) =>
    entry.url ?? entry.feed.siteUrl;

  const getEntryDownloadName = (entry: { feed: { siteUrl: string | null; title: string | null }; title: string | null; url: string | null }) =>
    getSafeDownloadName(entry.title ?? entry.url ?? entry.feed.title ?? entry.feed.siteUrl ?? "rss-boi-post");

  const getContentDisposition = (filename: string) =>
    `attachment; filename="${filename.replace(/"/g, "")}"`;

  const downloadImages = async (imageSources: string[], baseName: string) => {
    const downloads = await Promise.allSettled(
      imageSources.map(async (source, index) => {
        const response = await fetch(source, {
          headers: {
            "User-Agent": "rss-boi/0.2",
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok)
          throw new Error(`Unable to fetch ${source}`);

        const contentType = response.headers.get("content-type") ?? "";
        const data = Buffer.from(await response.arrayBuffer());

        return {
          contentType,
          data,
          name: `${baseName}-image-${index + 1}${getImageExtension(source, contentType)}`,
        };
      }),
    );

    return downloads.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  };

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

  fastify.get("/entries/:id/images.zip", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
      include: {
        feed: true,
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    const baseName = getEntryDownloadName(entry);
    const imageSources = getImageSourcesFromHtml(getEntryArticleHtml(entry), getEntrySourceUrl(entry));

    if (!imageSources.length)
      return reply.code(404).send({ message: "Entry has no downloadable images." });

    const files = await downloadImages(imageSources, baseName);

    if (!files.length)
      return reply.code(502).send({ message: "No images could be downloaded from the source." });

    return reply
      .header("Content-Disposition", getContentDisposition(`${baseName}-images.zip`))
      .type("application/zip")
      .send(createZipBuffer(files));
  });

  fastify.get("/entries/:id/article.pdf", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const entry = await prisma.entry.findFirst({
      where: getEntryWhereForUser(request.user!.id, id),
      include: {
        feed: true,
      },
    });

    if (!entry)
      return reply.code(404).send({ message: "Entry not found." });

    const sourceUrl = getEntrySourceUrl(entry);
    const title = entry.title ?? sourceUrl ?? "Untitled entry";
    const baseName = getEntryDownloadName(entry);
    const imageSources = getImageSourcesFromHtml(getEntryArticleHtml(entry), sourceUrl);
    const downloadedImages = await downloadImages(imageSources, baseName);
    const pdfImages = downloadedImages.flatMap((image) => {
      const pdfImage = getPdfImage(image.data, image.contentType);
      return pdfImage ? [pdfImage] : [];
    });
    const articleText = getPlainTextFromHtml(getEntryArticleHtml(entry)) || "No article content was captured for this entry.";
    const meta = [
      `Feed: ${entry.feed.title ?? "Untitled feed"}`,
      `Published: ${entry.publishedAt ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(entry.publishedAt) : "Not published"}`,
      entry.author ? `Author: ${entry.author}` : null,
      sourceUrl ? `Source: ${sourceUrl}` : null,
    ].filter((line): line is string => !!line);
    const body = `${meta.join("\n")}\n\n${articleText}`;
    const filename = `${baseName}.pdf`;

    return reply
      .header("Content-Disposition", getContentDisposition(filename))
      .type("application/pdf")
      .send(createPdfBuffer(title, body, pdfImages));
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
